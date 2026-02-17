/**
 * SourceFence — Popup Script
 *
 * Manages the extension popup UI: displays current profile status,
 * renders and manages location/company restriction rules, and
 * handles tab switching, rule CRUD, and footer actions.
 */
(function () {
  'use strict';

  // -----------------------------------------------------------------------
  // Storage keys
  // -----------------------------------------------------------------------

  const STORAGE_KEYS = {
    locationRules: 'sourcefence_location_rules',
    companyRules: 'sourcefence_company_rules',
    settings: 'sourcefence_settings',
    lastSync: 'sourcefence_last_sync'
  };

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------

  let locationRules = [];
  let companyRules = [];
  let activeTab = 'locations';

  // -----------------------------------------------------------------------
  // DOM references
  // -----------------------------------------------------------------------

  const dom = {};

  function cacheDom() {
    dom.statusSection = document.getElementById('status-section');
    dom.statusPrimary = document.getElementById('status-primary');
    dom.statusDetail = document.getElementById('status-detail');
    dom.statusBadge = document.getElementById('status-badge');
    dom.statsRules = document.getElementById('stats-rules');
    dom.statsSync = document.getElementById('stats-sync');

    dom.tabLocations = document.getElementById('tab-locations');
    dom.tabCompanies = document.getElementById('tab-companies');
    dom.panelLocations = document.getElementById('panel-locations');
    dom.panelCompanies = document.getElementById('panel-companies');

    dom.ruleListLocations = document.getElementById('rule-list-locations');
    dom.ruleListCompanies = document.getElementById('rule-list-companies');

    dom.addFormLocations = document.getElementById('add-form-locations');
    dom.addFormCompanies = document.getElementById('add-form-companies');

    dom.syncBtn = document.getElementById('sync-btn');
    dom.settingsLink = document.getElementById('settings-link');

    // Backend connection DOM
    dom.backendNotConfigured = document.getElementById('backend-not-configured');
    dom.backendSignIn = document.getElementById('backend-sign-in');
    dom.backendConnected = document.getElementById('backend-connected');
    dom.backendConfigureLink = document.getElementById('backend-configure-link');
    dom.signInForm = document.getElementById('sign-in-form');
    dom.signInEmail = document.getElementById('sign-in-email');
    dom.signInPassword = document.getElementById('sign-in-password');
    dom.signInError = document.getElementById('sign-in-error');
    dom.signInBtn = document.getElementById('sign-in-btn');
    dom.signOutBtn = document.getElementById('sign-out-btn');
    dom.backendUserEmail = document.getElementById('backend-user-email');
  }

  // -----------------------------------------------------------------------
  // Load rules from chrome.storage.local
  // -----------------------------------------------------------------------

  function loadRules() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(
        [STORAGE_KEYS.locationRules, STORAGE_KEYS.companyRules],
        function (data) {
          locationRules = Array.isArray(data[STORAGE_KEYS.locationRules])
            ? data[STORAGE_KEYS.locationRules]
            : [];
          companyRules = Array.isArray(data[STORAGE_KEYS.companyRules])
            ? data[STORAGE_KEYS.companyRules]
            : [];
          resolve();
        }
      );
    });
  }

  // -----------------------------------------------------------------------
  // Load stats (sync time)
  // -----------------------------------------------------------------------

  function loadStats() {
    return new Promise(function (resolve) {
      chrome.storage.local.get(STORAGE_KEYS.lastSync, function (data) {
        const lastSync = data[STORAGE_KEYS.lastSync];
        if (lastSync) {
          const date = new Date(lastSync);
          dom.statsSync.textContent = 'Last synced: ' + formatTime(date);
        } else {
          dom.statsSync.textContent = 'Last synced: Never';
        }
        resolve();
      });
    });
  }

  /**
   * Format a Date into a short readable string.
   * @param {Date} date
   * @returns {string}
   */
  function formatTime(date) {
    const now = new Date();
    const diffMs = now - date;
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return diffMin + 'm ago';

    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return diffHr + 'h ago';

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // -----------------------------------------------------------------------
  // Update stats bar
  // -----------------------------------------------------------------------

  function updateStatsCount() {
    const activeCount =
      locationRules.filter(function (r) { return r.active !== false; }).length +
      companyRules.filter(function (r) { return r.active !== false; }).length;
    dom.statsRules.textContent = activeCount + ' rule' + (activeCount !== 1 ? 's' : '') + ' active';
  }

  // -----------------------------------------------------------------------
  // Render rules list
  // -----------------------------------------------------------------------

  function renderRules(type) {
    const rules = type === 'locations' ? locationRules : companyRules;
    const listEl = type === 'locations' ? dom.ruleListLocations : dom.ruleListCompanies;

    listEl.innerHTML = '';

    if (rules.length === 0) {
      const emptyEl = document.createElement('li');
      emptyEl.className = 'rule-list__empty';
      emptyEl.textContent = 'No ' + (type === 'locations' ? 'location' : 'company') + ' rules yet.';
      listEl.appendChild(emptyEl);
      return;
    }

    rules.forEach(function (rule) {
      const li = document.createElement('li');
      li.className = 'rule-item';

      // Severity dot
      const dot = document.createElement('span');
      dot.className = 'rule-item__severity rule-item__severity--' + rule.severity;
      li.appendChild(dot);

      // Content wrapper
      const content = document.createElement('div');
      content.className = 'rule-item__content';

      const pattern = document.createElement('span');
      pattern.className = 'rule-item__pattern';
      pattern.textContent = rule.pattern;
      content.appendChild(pattern);

      if (rule.message) {
        const message = document.createElement('p');
        message.className = 'rule-item__message';
        message.textContent = rule.message;
        content.appendChild(message);
      }

      if (rule.expires_at) {
        const expiry = document.createElement('p');
        expiry.className = 'rule-item__expiry';
        expiry.textContent = 'Expires: ' + rule.expires_at;
        content.appendChild(expiry);
      }

      li.appendChild(content);

      // Delete button
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'rule-item__delete';
      deleteBtn.textContent = '\u00D7';
      deleteBtn.title = 'Delete rule';
      deleteBtn.setAttribute('aria-label', 'Delete rule: ' + rule.pattern);
      deleteBtn.addEventListener('click', function () {
        deleteRule(type, rule.id);
      });
      li.appendChild(deleteBtn);

      listEl.appendChild(li);
    });
  }

  // -----------------------------------------------------------------------
  // Add rule
  // -----------------------------------------------------------------------

  function addRule(type) {
    const patternInput = document.getElementById('pattern-' + type);
    const severityInput = document.getElementById('severity-' + type);
    const messageInput = document.getElementById('message-' + type);

    const pattern = patternInput.value.trim();
    const severity = severityInput.value;
    const message = messageInput.value.trim();

    if (!pattern) {
      patternInput.focus();
      return;
    }

    if (!severity) {
      severityInput.focus();
      return;
    }

    const prefix = type === 'locations' ? 'lr_' : 'cr_';
    const rule = {
      id: prefix + Date.now(),
      pattern: pattern,
      severity: severity,
      message: message,
      active: true,
      source: 'local'
    };

    // Add optional expiry for company rules
    if (type === 'companies') {
      const expiryInput = document.getElementById('expiry-companies');
      const expiryValue = expiryInput.value;
      if (expiryValue) {
        rule.expires_at = expiryValue;
      }
    }

    const storageKey = type === 'locations' ? STORAGE_KEYS.locationRules : STORAGE_KEYS.companyRules;
    const rules = type === 'locations' ? locationRules : companyRules;
    rules.push(rule);

    const update = {};
    update[storageKey] = rules;

    chrome.storage.local.set(update, function () {
      renderRules(type);
      updateStatsCount();
    });

    // Clear form
    patternInput.value = '';
    severityInput.value = '';
    messageInput.value = '';
    if (type === 'companies') {
      document.getElementById('expiry-companies').value = '';
    }
  }

  // -----------------------------------------------------------------------
  // Delete rule
  // -----------------------------------------------------------------------

  function deleteRule(type, id) {
    const storageKey = type === 'locations' ? STORAGE_KEYS.locationRules : STORAGE_KEYS.companyRules;

    if (type === 'locations') {
      locationRules = locationRules.filter(function (r) { return r.id !== id; });
    } else {
      companyRules = companyRules.filter(function (r) { return r.id !== id; });
    }

    const rules = type === 'locations' ? locationRules : companyRules;
    const update = {};
    update[storageKey] = rules;

    chrome.storage.local.set(update, function () {
      renderRules(type);
      updateStatsCount();
    });
  }

  // -----------------------------------------------------------------------
  // Status display
  // -----------------------------------------------------------------------

  function updateStatus(data) {
    if (!data) {
      setStatusNeutral('Navigate to a LinkedIn profile to see status');
      return;
    }

    if (data.error) {
      setStatusNeutral('Unable to read profile data');
      return;
    }

    // Build primary line: candidate name or location/employer summary
    const parts = [];
    if (data.name) parts.push(data.name);

    let detail = '';
    if (data.location) detail += data.location;
    if (data.company) {
      detail += (detail ? ' \u2022 ' : '') + data.company;
    }

    dom.statusPrimary.textContent = parts.length > 0 ? parts.join(' ') : (detail || 'Profile detected');
    dom.statusDetail.textContent = parts.length > 0 ? detail : '';

    // Set severity if match result is present
    if (data.severity) {
      setStatusSeverity(data.severity, data.message);
    } else {
      setStatusSeverity('green', '');
    }
  }

  function setStatusSearch(flaggedCount, redCount, amberCount, totalCards) {
    if (flaggedCount > 0) {
      dom.statusPrimary.textContent = 'Search results scanned';

      var parts = [];
      if (redCount > 0) parts.push(redCount + ' restricted');
      if (amberCount > 0) parts.push(amberCount + ' caution');
      dom.statusDetail.textContent = parts.join(', ') + ' of ' + totalCards + ' candidates flagged';

      // Use the highest severity for the card color
      var severity = redCount > 0 ? 'red' : 'amber';
      dom.statusSection.className = 'status-card status-card--' + severity;
      dom.statusBadge.className = 'severity-badge severity-badge--' + severity;
      dom.statusBadge.textContent = flaggedCount + ' flagged';
    } else {
      dom.statusPrimary.textContent = 'Search results scanned';
      dom.statusDetail.textContent = totalCards
        ? totalCards + ' candidates checked — no restrictions found'
        : 'Scanning candidates for restrictions';
      dom.statusSection.className = 'status-card status-card--green';
      dom.statusBadge.className = 'severity-badge severity-badge--green';
      dom.statusBadge.textContent = 'Clear';
    }
  }

  function setStatusNeutral(text) {
    dom.statusPrimary.textContent = text;
    dom.statusDetail.textContent = '';
    dom.statusSection.className = 'status-card status-card--neutral';
    dom.statusBadge.className = 'severity-badge severity-badge--hidden';
    dom.statusBadge.textContent = '';
  }

  function setStatusSeverity(severity, message) {
    dom.statusSection.className = 'status-card status-card--' + severity;

    dom.statusBadge.className = 'severity-badge severity-badge--' + severity;
    dom.statusBadge.textContent = severity.charAt(0).toUpperCase() + severity.slice(1);

    if (message) {
      // Append the match message to detail if it differs from current detail
      const current = dom.statusDetail.textContent;
      if (current && !current.includes(message)) {
        dom.statusDetail.textContent = current + ' \u2014 ' + message;
      } else if (!current) {
        dom.statusDetail.textContent = message;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Tab switching
  // -----------------------------------------------------------------------

  function switchTab(tab) {
    activeTab = tab;

    const isLocations = tab === 'locations';

    dom.tabLocations.classList.toggle('tabs__tab--active', isLocations);
    dom.tabCompanies.classList.toggle('tabs__tab--active', !isLocations);
    dom.tabLocations.setAttribute('aria-selected', String(isLocations));
    dom.tabCompanies.setAttribute('aria-selected', String(!isLocations));

    dom.panelLocations.classList.toggle('tab-panel--hidden', !isLocations);
    dom.panelCompanies.classList.toggle('tab-panel--hidden', isLocations);
  }

  // -----------------------------------------------------------------------
  // Query active tab for profile status
  // -----------------------------------------------------------------------

  /**
   * Check if a URL is a LinkedIn search page (not a single profile).
   */
  function isSearchPageUrl(url) {
    return (
      url.includes('/talent/search') ||
      (url.includes('/talent/hire') && !url.includes('/profile')) ||
      url.includes('/sales/search') ||
      url.includes('/search/results')
    );
  }

  function queryActiveTab() {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (!tabs || tabs.length === 0) {
        updateStatus(null);
        return;
      }

      const tab = tabs[0];
      const url = tab.url || '';

      // Check if we are on a LinkedIn page that the content script runs on
      const isLinkedIn =
        url.includes('linkedin.com/in/') ||
        url.includes('linkedin.com/talent/') ||
        url.includes('linkedin.com/sales/') ||
        url.includes('linkedin.com/search/');

      if (!isLinkedIn) {
        updateStatus(null);
        return;
      }

      // Search pages get their own status display
      if (isSearchPageUrl(url)) {
        chrome.tabs.sendMessage(tab.id, { type: 'GET_SEARCH_STATUS' }, function (response) {
          if (chrome.runtime.lastError || !response || response.type !== 'SEARCH_STATUS') {
            setStatusSearch(0, 0, 0);
            return;
          }
          var d = response.data;
          setStatusSearch(d.flaggedCount, d.redCount, d.amberCount, d.totalCards);
        });
        return;
      }

      // Ask the content script for current parse result
      chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' }, function (response) {
        if (chrome.runtime.lastError) {
          // Content script might not be loaded yet or no response
          setStatusNeutral('Unable to read profile data');
          return;
        }

        if (response && response.type === 'PARSE_RESULT') {
          updateStatus(response.data);
        } else {
          setStatusNeutral('Waiting for profile data...');
        }
      });
    });
  }

  // -----------------------------------------------------------------------
  // Message listener (from content script / service worker)
  // -----------------------------------------------------------------------

  function setupMessageListener() {
    chrome.runtime.onMessage.addListener(function (message) {
      if (!message || !message.type) return;

      if (message.type === 'PARSE_RESULT') {
        updateStatus(message.data);
      }

      if (message.type === 'MATCH_RESULT') {
        if (message.data && message.data.severity) {
          setStatusSeverity(message.data.severity, message.data.message);
        }
      }
    });
  }

  // -----------------------------------------------------------------------
  // Event binding
  // -----------------------------------------------------------------------

  function bindEvents() {
    // Tab switching
    dom.tabLocations.addEventListener('click', function () {
      switchTab('locations');
    });

    dom.tabCompanies.addEventListener('click', function () {
      switchTab('companies');
    });

    // Add rule forms
    dom.addFormLocations.addEventListener('submit', function (e) {
      e.preventDefault();
      addRule('locations');
    });

    dom.addFormCompanies.addEventListener('submit', function (e) {
      e.preventDefault();
      addRule('companies');
    });

    // Sync button — triggers backend sync
    dom.syncBtn.addEventListener('click', function () {
      if (dom.syncBtn.disabled) return;
      triggerSync();
    });

    // Settings link
    dom.settingsLink.addEventListener('click', function (e) {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });

    // Backend configure link (opens settings page)
    if (dom.backendConfigureLink) {
      dom.backendConfigureLink.addEventListener('click', function (e) {
        e.preventDefault();
        chrome.runtime.openOptionsPage();
      });
    }

    // Sign-in form submission
    if (dom.signInForm) {
      dom.signInForm.addEventListener('submit', function (e) {
        e.preventDefault();
        handleSignInSubmit();
      });
    }

    // Sign-out button
    if (dom.signOutBtn) {
      dom.signOutBtn.addEventListener('click', function () {
        handleSignOutClick();
      });
    }
  }

  // -----------------------------------------------------------------------
  // Backend auth — UI state management
  // -----------------------------------------------------------------------

  /**
   * Show the appropriate backend section based on auth status.
   * @param {{configured: boolean, signedIn: boolean, email?: string}} status
   */
  function showBackendState(status) {
    // Hide all states first
    if (dom.backendNotConfigured) dom.backendNotConfigured.style.display = 'none';
    if (dom.backendSignIn) dom.backendSignIn.style.display = 'none';
    if (dom.backendConnected) dom.backendConnected.style.display = 'none';

    if (!status.configured) {
      // Not configured — show link to settings
      if (dom.backendNotConfigured) dom.backendNotConfigured.style.display = 'block';
      dom.syncBtn.disabled = true;
      dom.syncBtn.title = 'Connect backend in Settings';
    } else if (!status.signedIn) {
      // Configured but not signed in — show sign-in form
      if (dom.backendSignIn) dom.backendSignIn.style.display = 'block';
      dom.syncBtn.disabled = true;
      dom.syncBtn.title = 'Sign in to sync rules';
    } else {
      // Signed in — show connected state
      if (dom.backendConnected) dom.backendConnected.style.display = 'block';
      if (dom.backendUserEmail) dom.backendUserEmail.textContent = status.email || '';
      dom.syncBtn.disabled = false;
      dom.syncBtn.title = 'Sync rules from backend';
    }
  }

  /**
   * Query the service worker for the current auth status and update the UI.
   */
  function checkAuthStatus() {
    chrome.runtime.sendMessage({ type: 'GET_AUTH_STATUS' }, function (response) {
      if (chrome.runtime.lastError) {
        showBackendState({ configured: false, signedIn: false });
        return;
      }

      if (response && response.ok) {
        showBackendState(response);
      } else {
        showBackendState({ configured: false, signedIn: false });
      }
    });
  }

  /**
   * Handle sign-in form submission.
   */
  function handleSignInSubmit() {
    var email = dom.signInEmail.value.trim();
    var password = dom.signInPassword.value;

    if (!email || !password) return;

    // Show loading state
    dom.signInBtn.disabled = true;
    dom.signInBtn.textContent = 'Signing in...';
    if (dom.signInError) dom.signInError.style.display = 'none';

    chrome.runtime.sendMessage(
      { type: 'SIGN_IN', email: email, password: password },
      function (response) {
        dom.signInBtn.disabled = false;
        dom.signInBtn.textContent = 'Sign In';

        if (chrome.runtime.lastError) {
          showSignInError('Unable to connect to service worker.');
          return;
        }

        if (response && response.ok) {
          // Sign-in succeeded — refresh UI
          checkAuthStatus();
          // Reload rules and stats since sync was triggered
          setTimeout(function () {
            loadRules().then(function () {
              renderRules('locations');
              renderRules('companies');
              updateStatsCount();
            });
            loadStats();
          }, 1500);
        } else {
          showSignInError((response && response.error) || 'Sign-in failed.');
        }
      }
    );
  }

  /**
   * Show a sign-in error message.
   * @param {string} message
   */
  function showSignInError(message) {
    if (dom.signInError) {
      dom.signInError.textContent = message;
      dom.signInError.style.display = 'block';
    }
  }

  /**
   * Handle sign-out button click.
   */
  function handleSignOutClick() {
    chrome.runtime.sendMessage({ type: 'SIGN_OUT' }, function (response) {
      if (chrome.runtime.lastError) {
        // Ignore — just refresh status
      }
      checkAuthStatus();
    });
  }

  /**
   * Trigger a manual sync and show loading state on the button.
   */
  function triggerSync() {
    dom.syncBtn.disabled = true;
    dom.syncBtn.textContent = 'Syncing...';

    chrome.runtime.sendMessage({ type: 'SYNC_RULES' }, function (response) {
      dom.syncBtn.disabled = false;
      dom.syncBtn.textContent = 'Sync Rules';

      if (chrome.runtime.lastError) {
        console.warn('[SourceFence] Sync failed:', chrome.runtime.lastError.message);
        return;
      }

      if (response && response.ok) {
        // Reload rules and stats
        loadRules().then(function () {
          renderRules('locations');
          renderRules('companies');
          updateStatsCount();
        });
        loadStats();
      } else {
        console.warn('[SourceFence] Sync returned error:', response && response.error);
      }
    });
  }

  // -----------------------------------------------------------------------
  // Initialization
  // -----------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    cacheDom();
    bindEvents();
    setupMessageListener();

    // Load data and render
    Promise.all([loadRules(), loadStats()]).then(function () {
      renderRules('locations');
      renderRules('companies');
      updateStatsCount();
      queryActiveTab();
    });

    // Check backend auth status
    checkAuthStatus();
  });
})();
