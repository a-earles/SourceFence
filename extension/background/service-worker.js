'use strict';

// Import the lightweight Supabase client for backend integration.
importScripts('../lib/supabase-client.js');

// ---------------------------------------------------------------------------
// SourceFence — Manifest V3 Service Worker
// ---------------------------------------------------------------------------
// This service worker is NOT persistent. It wakes on events and goes back to
// sleep. All state is kept in chrome.storage so it survives wake/sleep cycles.
// All event listeners are registered at the top level of the script so that
// Chrome can wire them up on every wake before the worker goes idle.
// ---------------------------------------------------------------------------

// ---- Constants ------------------------------------------------------------

const STORAGE_KEYS = {
  CURRENT_PROFILE: 'sourcefence_current_profile',
  CURRENT_MATCH: 'sourcefence_current_match',
  SETTINGS: 'sourcefence_settings',
  LOCATION_RULES: 'sourcefence_location_rules',
  COMPANY_RULES: 'sourcefence_company_rules',
  BACKEND_CONFIG: 'sourcefence_backend_config',
  SESSION: 'sourcefence_session',
  LAST_SYNC: 'sourcefence_last_sync',
};

const DEFAULT_SETTINGS = {
  enabled: true,
  show_green_alerts: true,
  green_auto_dismiss_seconds: 5,
  alert_position: 'top',
};

const BADGE_COLORS = {
  red: '#DC2626',
  amber: '#F59E0B',
};

const SYNC_ALARM_NAME = 'sourcefence-sync';
const SYNC_INTERVAL_MINUTES = 15;

const LINKEDIN_URL_PATTERNS = [
  /^https?:\/\/(www\.)?linkedin\.com\/in\//,
  /^https?:\/\/(www\.)?linkedin\.com\/talent\//,
  /^https?:\/\/(www\.)?linkedin\.com\/sales\//,
];

// ---- Utility functions ----------------------------------------------------

/**
 * Returns true when the given URL is a LinkedIn profile / talent / sales page
 * that SourceFence should act on.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isLinkedInProfileUrl(url) {
  if (!url) return false;
  return LINKEDIN_URL_PATTERNS.some((pattern) => pattern.test(url));
}

/**
 * Update the extension badge for a specific tab.
 *
 * @param {number}  tabId
 * @param {'red'|'amber'|'green'|null} severity
 */
function updateBadge(tabId, severity) {
  if (severity === 'red' || severity === 'amber') {
    chrome.action.setBadgeText({ text: '!', tabId });
    chrome.action.setBadgeBackgroundColor({
      color: BADGE_COLORS[severity],
      tabId,
    });
  } else {
    // green or unknown — clear the badge
    chrome.action.setBadgeText({ text: '', tabId });
  }
}

/**
 * Send a message to every LinkedIn tab that is currently open.
 *
 * @param {object} message
 */
async function notifyLinkedInTabs(message) {
  try {
    const tabs = await chrome.tabs.query({ url: '*://*.linkedin.com/*' });
    for (const tab of tabs) {
      if (tab.id && isLinkedInProfileUrl(tab.url)) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // Content script might not be injected yet — safe to ignore.
        });
      }
    }
  } catch (err) {
    console.warn('[SourceFence] Failed to notify LinkedIn tabs:', err);
  }
}

// ---- Message handler ------------------------------------------------------

/**
 * Central message router. Handles messages from content scripts and the popup.
 *
 * @param {object}       message
 * @param {object}       sender
 * @param {function}     sendResponse
 * @returns {boolean|undefined}  Return true to keep the message channel open
 *                               for async sendResponse calls.
 */
function handleMessage(message, sender, sendResponse) {
  if (!message || !message.type) return;

  switch (message.type) {
    // -- Content script parsed a LinkedIn profile ---------------------------
    case 'PARSE_RESULT': {
      chrome.storage.local.set({
        [STORAGE_KEYS.CURRENT_PROFILE]: message.data,
      });
      sendResponse({ ok: true });
      break;
    }

    // -- Content script / matcher produced a match result -------------------
    case 'MATCH_RESULT': {
      chrome.storage.local.set({
        [STORAGE_KEYS.CURRENT_MATCH]: message.data,
      });

      // Determine the tab to badge. Prefer the sender tab; fall back to the
      // tabId included in the message payload.
      const tabId =
        (sender && sender.tab && sender.tab.id) || message.tabId || null;

      if (tabId) {
        const severity = message.data && message.data.severity;
        updateBadge(tabId, severity);
      }

      sendResponse({ ok: true });
      break;
    }

    // -- Popup requests the current ruleset ---------------------------------
    case 'GET_RULES': {
      chrome.storage.local.get(
        [STORAGE_KEYS.LOCATION_RULES, STORAGE_KEYS.COMPANY_RULES],
        (result) => {
          sendResponse({
            locationRules: result[STORAGE_KEYS.LOCATION_RULES] || [],
            companyRules: result[STORAGE_KEYS.COMPANY_RULES] || [],
          });
        }
      );
      // Keep channel open for the async callback.
      return true;
    }

    // -- Popup / options page triggers a rule sync --------------------------
    case 'SYNC_RULES': {
      performBackendSync().then(function (result) {
        sendResponse(result);
      }).catch(function (err) {
        sendResponse({ ok: false, error: err.message });
      });
      return true; // keep channel open for async response
    }

    // -- Sign in to backend -------------------------------------------------
    case 'SIGN_IN': {
      handleSignIn(message.email, message.password).then(function (result) {
        sendResponse(result);
      }).catch(function (err) {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }

    // -- Sign out of backend ------------------------------------------------
    case 'SIGN_OUT': {
      handleSignOut().then(function (result) {
        sendResponse(result);
      }).catch(function (err) {
        sendResponse({ ok: false, error: err.message });
      });
      return true;
    }

    // -- Check auth status --------------------------------------------------
    case 'GET_AUTH_STATUS': {
      getAuthStatus().then(function (result) {
        sendResponse(result);
      }).catch(function (err) {
        sendResponse({ ok: false, configured: false, signedIn: false });
      });
      return true;
    }

    // -- Popup requests the current status ----------------------------------
    case 'GET_STATUS': {
      chrome.storage.local.get(
        [STORAGE_KEYS.CURRENT_PROFILE, STORAGE_KEYS.CURRENT_MATCH],
        (result) => {
          sendResponse({
            profile: result[STORAGE_KEYS.CURRENT_PROFILE] || null,
            match: result[STORAGE_KEYS.CURRENT_MATCH] || null,
          });
        }
      );
      return true;
    }

    default:
      // Unknown message type — no action.
      break;
  }
}

// ---- Tab update handler ---------------------------------------------------

/**
 * Fires when a tab's properties change. We care about URL changes on
 * LinkedIn profile pages so we can tell the content script to re-parse.
 *
 * @param {number} tabId
 * @param {object} changeInfo
 * @param {object} tab
 */
function handleTabUpdate(tabId, changeInfo, tab) {
  // Only act when the URL actually changed (not on every status update).
  if (!changeInfo.url) return;

  if (isLinkedInProfileUrl(changeInfo.url)) {
    chrome.tabs.sendMessage(tabId, {
      type: 'URL_CHANGED',
      url: changeInfo.url,
    }).catch(() => {
      // Content script might not be ready yet — safe to ignore.
    });
  }
}

// ---- Install / update handler ---------------------------------------------

/**
 * Runs on first install and on extension updates. Sets up default storage
 * values and the periodic sync alarm.
 *
 * @param {object} details
 */
async function handleInstall(details) {
  console.log(
    `[SourceFence] onInstalled — reason: ${details.reason}`
  );

  // Initialize default settings if not already present.
  try {
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.SETTINGS,
      STORAGE_KEYS.LOCATION_RULES,
      STORAGE_KEYS.COMPANY_RULES,
    ]);

    const updates = {};

    if (!result[STORAGE_KEYS.SETTINGS]) {
      updates[STORAGE_KEYS.SETTINGS] = DEFAULT_SETTINGS;
    }

    if (!result[STORAGE_KEYS.LOCATION_RULES]) {
      updates[STORAGE_KEYS.LOCATION_RULES] = [];
    }

    if (!result[STORAGE_KEYS.COMPANY_RULES]) {
      updates[STORAGE_KEYS.COMPANY_RULES] = [];
    }

    if (Object.keys(updates).length > 0) {
      await chrome.storage.local.set(updates);
      console.log('[SourceFence] Default storage values initialized.');
    }
  } catch (err) {
    console.error('[SourceFence] Failed to initialize storage:', err);
  }

  // Create (or re-create) the periodic sync alarm.
  try {
    await chrome.alarms.create(SYNC_ALARM_NAME, {
      periodInMinutes: SYNC_INTERVAL_MINUTES,
    });
    console.log(
      `[SourceFence] Sync alarm created (every ${SYNC_INTERVAL_MINUTES} min).`
    );
  } catch (err) {
    console.error('[SourceFence] Failed to create alarm:', err);
  }

  // If backend is configured and session exists, trigger an immediate sync.
  try {
    await ensureSupabaseInit();
    if (SupabaseClient.isConfigured() && SupabaseClient.hasSession()) {
      console.log('[SourceFence] Backend configured with session — triggering initial sync.');
      performBackendSync().catch(function (err) {
        console.warn('[SourceFence] Initial sync on install/update failed:', err);
      });
    }
  } catch (err) {
    console.warn('[SourceFence] Failed to check backend on install:', err);
  }
}

// ---- Alarm handler --------------------------------------------------------

/**
 * Fires when a chrome.alarms alarm goes off. Currently only handles the
 * periodic sync alarm.
 *
 * @param {object} alarm
 */
function handleAlarm(alarm) {
  if (alarm.name !== SYNC_ALARM_NAME) return;

  performBackendSync().then(function (result) {
    if (result.ok) {
      console.log('[SourceFence] Periodic sync completed successfully.');
    } else {
      console.log('[SourceFence] Periodic sync skipped or failed:', result.error || result.reason);
    }
  }).catch(function (err) {
    console.warn('[SourceFence] Periodic sync error:', err);
  });
}

// ---- Backend sync logic ---------------------------------------------------

/**
 * Initialize the SupabaseClient. Safe to call multiple times;
 * it will re-read config/session from storage each time.
 *
 * @returns {Promise<void>}
 */
async function ensureSupabaseInit() {
  await SupabaseClient.init();
}

/**
 * Perform a full sync of rules from the Supabase backend.
 * Merges backend rules with any local-only rules (source: "local").
 *
 * @returns {Promise<{ok: boolean, error?: string, reason?: string}>}
 */
async function performBackendSync() {
  await ensureSupabaseInit();

  if (!SupabaseClient.isConfigured()) {
    return { ok: false, reason: 'Backend not configured.' };
  }

  if (!SupabaseClient.hasSession()) {
    return { ok: false, reason: 'Not signed in.' };
  }

  console.log('[SourceFence] Starting backend sync...');

  try {
    // Fetch rules from backend in parallel
    var results = await Promise.all([
      SupabaseClient.fetchLocationRules(),
      SupabaseClient.fetchCompanyRules(),
    ]);

    var locationResult = results[0];
    var companyResult = results[1];

    if (!locationResult.ok || !companyResult.ok) {
      var errMsg = (locationResult.error || '') + ' ' + (companyResult.error || '');
      console.warn('[SourceFence] Backend sync partial failure:', errMsg.trim());
      return { ok: false, error: errMsg.trim() };
    }

    // Get current local rules to preserve local-only entries
    var stored = await new Promise(function (resolve) {
      chrome.storage.local.get(
        [STORAGE_KEYS.LOCATION_RULES, STORAGE_KEYS.COMPANY_RULES],
        resolve
      );
    });

    var existingLocationRules = stored[STORAGE_KEYS.LOCATION_RULES] || [];
    var existingCompanyRules = stored[STORAGE_KEYS.COMPANY_RULES] || [];

    // Keep local-only rules (rules with source: "local" or no source field
    // that were created locally by the user via the popup)
    var localLocationRules = existingLocationRules.filter(function (r) {
      return r.source === 'local';
    });
    var localCompanyRules = existingCompanyRules.filter(function (r) {
      return r.source === 'local';
    });

    // Tag backend rules with source: "backend"
    var backendLocationRules = (locationResult.data || []).map(function (r) {
      r.source = 'backend';
      return r;
    });
    var backendCompanyRules = (companyResult.data || []).map(function (r) {
      r.source = 'backend';
      return r;
    });

    // Merge: local-only first, then backend
    var mergedLocationRules = localLocationRules.concat(backendLocationRules);
    var mergedCompanyRules = localCompanyRules.concat(backendCompanyRules);

    // Save merged rules and update last sync timestamp
    var syncTimestamp = new Date().toISOString();
    var update = {};
    update[STORAGE_KEYS.LOCATION_RULES] = mergedLocationRules;
    update[STORAGE_KEYS.COMPANY_RULES] = mergedCompanyRules;
    update[STORAGE_KEYS.LAST_SYNC] = syncTimestamp;

    await new Promise(function (resolve) {
      chrome.storage.local.set(update, resolve);
    });

    // Notify all LinkedIn tabs
    await notifyLinkedInTabs({ type: 'RULES_UPDATED' });

    console.log(
      '[SourceFence] Sync complete.',
      'Location rules:', mergedLocationRules.length,
      'Company rules:', mergedCompanyRules.length
    );

    return { ok: true };
  } catch (err) {
    console.error('[SourceFence] performBackendSync error:', err);
    return { ok: false, error: err.message };
  }
}

/**
 * Handle a SIGN_IN message from the popup.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ok: boolean, user?: object, error?: string}>}
 */
async function handleSignIn(email, password) {
  await ensureSupabaseInit();

  if (!SupabaseClient.isConfigured()) {
    return { ok: false, error: 'Backend not configured. Set Supabase URL and key in Settings.' };
  }

  var result = await SupabaseClient.signIn(email, password);

  if (result.ok) {
    // Trigger an initial sync after successful sign-in
    performBackendSync().catch(function (err) {
      console.warn('[SourceFence] Post-sign-in sync failed:', err);
    });
  }

  return result;
}

/**
 * Handle a SIGN_OUT message from the popup.
 *
 * @returns {Promise<{ok: boolean}>}
 */
async function handleSignOut() {
  await ensureSupabaseInit();
  return SupabaseClient.signOut();
}

/**
 * Return the current authentication status.
 *
 * @returns {Promise<{ok: boolean, configured: boolean, signedIn: boolean, email?: string}>}
 */
async function getAuthStatus() {
  await ensureSupabaseInit();

  var configured = SupabaseClient.isConfigured();
  var session = await SupabaseClient.getSession();
  var signedIn = !!(session && session.access_token);
  var email = (signedIn && session.user && session.user.email) || null;

  return {
    ok: true,
    configured: configured,
    signedIn: signedIn,
    email: email,
  };
}

// ---- Storage change listener ----------------------------------------------

/**
 * Fires whenever chrome.storage values change. When rules are updated we
 * notify all open LinkedIn tabs so they can re-evaluate.
 *
 * @param {object} changes
 * @param {string} areaName
 */
function handleStorageChange(changes, areaName) {
  if (areaName !== 'local') return;

  const rulesChanged =
    STORAGE_KEYS.LOCATION_RULES in changes ||
    STORAGE_KEYS.COMPANY_RULES in changes;

  if (rulesChanged) {
    console.log('[SourceFence] Rules changed — notifying LinkedIn tabs.');
    notifyLinkedInTabs({ type: 'RULES_UPDATED' });
  }
}

// ---- Register all event listeners at the top level ------------------------
// Manifest V3 requires that listeners are registered synchronously during the
// initial execution of the service worker script. Listeners registered inside
// async callbacks or setTimeout will NOT persist across wake/sleep cycles.

chrome.runtime.onMessage.addListener(handleMessage);
chrome.tabs.onUpdated.addListener(handleTabUpdate);
chrome.runtime.onInstalled.addListener(handleInstall);
chrome.alarms.onAlarm.addListener(handleAlarm);
chrome.storage.onChanged.addListener(handleStorageChange);
