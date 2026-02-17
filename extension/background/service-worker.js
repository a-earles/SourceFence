'use strict';

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
};

const DEFAULT_SETTINGS = {
  enabled: true,
  show_green_alerts: true,
  green_auto_dismiss_seconds: 3,
};

const BADGE_COLORS = {
  red: '#DC2626',
  amber: '#F59E0B',
};

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
 * values.
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
chrome.storage.onChanged.addListener(handleStorageChange);
