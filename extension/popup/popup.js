/**
 * SourceFence — Popup Script
 *
 * Manages the extension popup UI: displays current profile status,
 * renders and manages location/company restriction rules, and
 * handles tab switching and rule CRUD.
 */
(function () {
  'use strict';

  // -----------------------------------------------------------------------
  // Storage keys
  // -----------------------------------------------------------------------

  var STORAGE_KEYS = {
    locationRules: 'sourcefence_location_rules',
    companyRules: 'sourcefence_company_rules',
    settings: 'sourcefence_settings'
  };

  // -----------------------------------------------------------------------
  // State
  // -----------------------------------------------------------------------

  var locationRules = [];
  var companyRules = [];
  var activeTab = 'locations';

  // -----------------------------------------------------------------------
  // DOM references
  // -----------------------------------------------------------------------

  var dom = {};

  function cacheDom() {
    dom.statusSection = document.getElementById('status-section');
    dom.statusPrimary = document.getElementById('status-primary');
    dom.statusDetail = document.getElementById('status-detail');
    dom.statusBadge = document.getElementById('status-badge');
    dom.statsRules = document.getElementById('stats-rules');

    dom.tabLocations = document.getElementById('tab-locations');
    dom.tabCompanies = document.getElementById('tab-companies');
    dom.panelLocations = document.getElementById('panel-locations');
    dom.panelCompanies = document.getElementById('panel-companies');

    dom.ruleListLocations = document.getElementById('rule-list-locations');
    dom.ruleListCompanies = document.getElementById('rule-list-companies');

    dom.addFormLocations = document.getElementById('add-form-locations');
    dom.addFormCompanies = document.getElementById('add-form-companies');

    dom.settingsLink = document.getElementById('settings-link');
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
  // Update stats bar
  // -----------------------------------------------------------------------

  function updateStatsCount() {
    var activeCount =
      locationRules.filter(function (r) { return r.active !== false; }).length +
      companyRules.filter(function (r) { return r.active !== false; }).length;
    dom.statsRules.textContent = activeCount + ' rule' + (activeCount !== 1 ? 's' : '') + ' active';
  }

  // -----------------------------------------------------------------------
  // Render rules list
  // -----------------------------------------------------------------------

  function renderRules(type) {
    var rules = type === 'locations' ? locationRules : companyRules;
    var listEl = type === 'locations' ? dom.ruleListLocations : dom.ruleListCompanies;

    listEl.innerHTML = '';

    if (rules.length === 0) {
      var emptyEl = document.createElement('li');
      emptyEl.className = 'rule-list__empty';

      if (type === 'locations') {
        emptyEl.innerHTML =
          '<strong>No location rules yet</strong><br>' +
          '<span class="rule-list__empty-hint">Add a rule below to flag candidates from specific locations. ' +
          'For example, add "India" as Red to restrict sourcing from that market.</span>';
      } else {
        emptyEl.innerHTML =
          '<strong>No company rules yet</strong><br>' +
          '<span class="rule-list__empty-hint">Add a rule below to flag candidates at specific companies. ' +
          'For example, add "Acme Corp" as Red for a non-solicit agreement.</span>';
      }
      listEl.appendChild(emptyEl);
      return;
    }

    rules.forEach(function (rule) {
      var li = document.createElement('li');
      li.className = 'rule-item';

      // Severity dot
      var dot = document.createElement('span');
      dot.className = 'rule-item__severity rule-item__severity--' + rule.severity;
      li.appendChild(dot);

      // Content wrapper
      var content = document.createElement('div');
      content.className = 'rule-item__content';

      var pattern = document.createElement('span');
      pattern.className = 'rule-item__pattern';
      pattern.textContent = rule.pattern;
      content.appendChild(pattern);

      if (rule.message) {
        var message = document.createElement('p');
        message.className = 'rule-item__message';
        message.textContent = rule.message;
        content.appendChild(message);
      }

      if (rule.expires_at) {
        var expiry = document.createElement('p');
        expiry.className = 'rule-item__expiry';
        expiry.textContent = 'Expires: ' + rule.expires_at;
        content.appendChild(expiry);
      }

      li.appendChild(content);

      // Delete button
      var deleteBtn = document.createElement('button');
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
    var patternInput = document.getElementById('pattern-' + type);
    var severityInput = document.getElementById('severity-' + type);
    var messageInput = document.getElementById('message-' + type);

    var pattern = patternInput.value.trim();
    var severity = severityInput.value;
    var message = messageInput.value.trim();

    if (!pattern) {
      patternInput.focus();
      return;
    }

    if (!severity) {
      severityInput.focus();
      return;
    }

    var prefix = type === 'locations' ? 'lr_' : 'cr_';
    var rule = {
      id: prefix + Date.now(),
      pattern: pattern,
      severity: severity,
      message: message,
      active: true,
      source: 'local'
    };

    // Add optional expiry for company rules
    if (type === 'companies') {
      var expiryInput = document.getElementById('expiry-companies');
      var expiryValue = expiryInput.value;
      if (expiryValue) {
        rule.expires_at = expiryValue;
      }
    }

    var storageKey = type === 'locations' ? STORAGE_KEYS.locationRules : STORAGE_KEYS.companyRules;
    var rules = type === 'locations' ? locationRules : companyRules;
    rules.push(rule);

    var update = {};
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
    var storageKey = type === 'locations' ? STORAGE_KEYS.locationRules : STORAGE_KEYS.companyRules;

    if (type === 'locations') {
      locationRules = locationRules.filter(function (r) { return r.id !== id; });
    } else {
      companyRules = companyRules.filter(function (r) { return r.id !== id; });
    }

    var rules = type === 'locations' ? locationRules : companyRules;
    var update = {};
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
    var parts = [];
    if (data.name) parts.push(data.name);

    var detail = '';
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
        ? totalCards + ' candidates checked \u2014 no restrictions found'
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
      var current = dom.statusDetail.textContent;
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

    var isLocations = tab === 'locations';

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

      var tab = tabs[0];
      var url = tab.url || '';

      // Check if we are on a LinkedIn page that the content script runs on
      var isLinkedIn =
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

    // Settings link
    dom.settingsLink.addEventListener('click', function (e) {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
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
    loadRules().then(function () {
      renderRules('locations');
      renderRules('companies');
      updateStatsCount();
      queryActiveTab();
    });
  });
})();
