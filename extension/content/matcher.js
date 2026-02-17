/**
 * SourceFence — Rule Matching Engine
 *
 * Loads restriction rules from chrome.storage.local, matches candidate
 * location and company against those rules using normalized substring
 * matching, and returns the highest-severity result.
 *
 * Exposed as window.SourceFenceMatcher
 */
(function () {
  'use strict';

  // -----------------------------------------------------------------------
  // Default rules — used only when storage is completely empty
  // -----------------------------------------------------------------------

  const DEFAULT_LOCATION_RULES = [
    {
      id: 'lr_default_1',
      pattern: 'India',
      severity: 'red',
      message: 'India hub — do not source. Route to APAC TA team.',
      active: true
    },
    {
      id: 'lr_default_2',
      pattern: 'Poland',
      severity: 'amber',
      message: 'Poland entity exists. Check with EU Ops before outreach.',
      active: true
    }
  ];

  const DEFAULT_COMPANY_RULES = [
    {
      id: 'cr_default_1',
      pattern: 'Acme Corp',
      severity: 'red',
      message: 'Active non-solicit agreement until Dec 2026.',
      active: true,
      expires_at: '2026-12-31'
    }
  ];

  // -----------------------------------------------------------------------
  // Severity ranking — higher number means more restrictive
  // -----------------------------------------------------------------------

  const SEVERITY_RANK = { green: 0, amber: 1, red: 2 };

  // -----------------------------------------------------------------------
  // Company-name suffixes to strip during normalization
  // -----------------------------------------------------------------------

  const COMPANY_SUFFIXES = [
    'incorporated',
    'inc.',
    'inc',
    'limited',
    'ltd.',
    'ltd',
    'corporation',
    'corp.',
    'corp',
    'llc',
    'l.l.c.',
    'gmbh',
    'ag',
    's.a.',
    'pty',
    'plc',
    'co.',
    'company'
  ];

  // Pre-build a regex that anchors each suffix at a word boundary at the end
  // of the string (after optional trailing whitespace).
  // Escaping dots for regex safety.
  const suffixPattern = new RegExp(
    '\\b(' +
      COMPANY_SUFFIXES.map(function (s) {
        return s.replace(/\./g, '\\.');
      }).join('|') +
      ')\\s*$',
    'i'
  );

  // -----------------------------------------------------------------------
  // Internal state
  // -----------------------------------------------------------------------

  var locationRules = [];
  var companyRules = [];
  var rulesLoaded = false;
  var loadPromise = null;

  // -----------------------------------------------------------------------
  // Normalization helpers
  // -----------------------------------------------------------------------

  /**
   * Normalize a string: lowercase, trim, strip diacritics.
   * @param {string} str
   * @returns {string}
   */
  function normalize(str) {
    if (typeof str !== 'string') return '';
    return str
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  /**
   * Normalize a company name: normalize() then strip common corporate
   * suffixes and trim again.
   * @param {string} str
   * @returns {string}
   */
  function normalizeCompanyName(str) {
    var n = normalize(str);
    // Repeatedly strip suffixes in case multiple are present (e.g. "Foo Corp LLC")
    var prev;
    do {
      prev = n;
      n = n.replace(suffixPattern, '').trim();
    } while (n !== prev);
    return n;
  }

  // -----------------------------------------------------------------------
  // Expiration check
  // -----------------------------------------------------------------------

  /**
   * Return true if a company rule's expires_at date is in the past.
   * Rules without an expires_at are never considered expired.
   * @param {object} rule
   * @returns {boolean}
   */
  function isExpired(rule) {
    if (!rule.expires_at) return false;
    var expiryDate = new Date(rule.expires_at);
    if (isNaN(expiryDate.getTime())) return false;
    // Compare against end of the expiry day (23:59:59.999) to treat the
    // entire expiry date as still valid.
    expiryDate.setHours(23, 59, 59, 999);
    return Date.now() > expiryDate.getTime();
  }

  // -----------------------------------------------------------------------
  // Rule loading
  // -----------------------------------------------------------------------

  /**
   * Load rules from chrome.storage.local.  Falls back to hardcoded
   * defaults when storage is completely empty.
   * @returns {Promise<void>}
   */
  function loadRules() {
    loadPromise = new Promise(function (resolve) {
      try {
        chrome.storage.local.get(
          ['sourcefence_location_rules', 'sourcefence_company_rules'],
          function (data) {
            var locRules = data.sourcefence_location_rules;
            var comRules = data.sourcefence_company_rules;

            var storageEmpty =
              (!Array.isArray(locRules) || locRules.length === 0) &&
              (!Array.isArray(comRules) || comRules.length === 0);

            if (storageEmpty) {
              locationRules = DEFAULT_LOCATION_RULES.slice();
              companyRules = DEFAULT_COMPANY_RULES.slice();
            } else {
              locationRules = Array.isArray(locRules) ? locRules : [];
              companyRules = Array.isArray(comRules) ? comRules : [];
            }

            rulesLoaded = true;
            resolve();
          }
        );
      } catch (err) {
        // If chrome.storage is unavailable (e.g. during unit tests), use
        // defaults so the matcher is still functional.
        console.warn('[SourceFence] Could not access chrome.storage:', err);
        locationRules = DEFAULT_LOCATION_RULES.slice();
        companyRules = DEFAULT_COMPANY_RULES.slice();
        rulesLoaded = true;
        resolve();
      }
    });

    return loadPromise;
  }

  // -----------------------------------------------------------------------
  // Matching functions
  // -----------------------------------------------------------------------

  /**
   * Match a candidate location against all active location rules.
   *
   * Rule patterns may contain comma-separated alternatives.  Matching uses
   * normalized substring containment (candidate contains alternative).
   *
   * @param {string} location  — raw candidate location string
   * @param {Array}  rules     — array of location rule objects
   * @returns {Array} array of { severity, message } for every matching rule
   */
  function matchLocation(location, rules) {
    var matches = [];
    if (!location) return matches;

    var normLocation = normalize(location);

    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (!rule.active) continue;

      // Split pattern on commas to get alternatives
      var alternatives = rule.pattern.split(',');

      for (var j = 0; j < alternatives.length; j++) {
        var normAlt = normalize(alternatives[j]);
        if (normAlt === '') continue;

        if (normLocation.indexOf(normAlt) !== -1) {
          matches.push({ severity: rule.severity, message: rule.message });
          break; // One matching alternative is enough for this rule
        }
      }
    }

    return matches;
  }

  /**
   * Match a candidate company/employer against all active, non-expired
   * company rules.
   *
   * Uses bidirectional normalized substring containment after stripping
   * common corporate suffixes.
   *
   * @param {string} company  — raw candidate employer string
   * @param {Array}  rules    — array of company rule objects
   * @returns {Array} array of { severity, message } for every matching rule
   */
  function matchCompany(company, rules) {
    var matches = [];
    if (!company) return matches;

    var normCompany = normalizeCompanyName(company);

    for (var i = 0; i < rules.length; i++) {
      var rule = rules[i];
      if (!rule.active) continue;
      if (isExpired(rule)) continue;

      var normPattern = normalizeCompanyName(rule.pattern);
      if (normPattern === '') continue;

      // Bidirectional substring: candidate contains pattern OR pattern
      // contains candidate (handles abbreviated vs. full names).
      if (
        normCompany.indexOf(normPattern) !== -1 ||
        normPattern.indexOf(normCompany) !== -1
      ) {
        matches.push({ severity: rule.severity, message: rule.message });
      }
    }

    return matches;
  }

  // -----------------------------------------------------------------------
  // Severity resolution
  // -----------------------------------------------------------------------

  /**
   * Given an array of { severity, message } match objects, return the
   * single highest-severity result.
   *
   * @param {Array} matches
   * @returns {{ severity: string, message: string }}
   */
  function resolveHighestSeverity(matches) {
    if (!matches || matches.length === 0) {
      return { severity: 'green', message: 'No restrictions. Source freely.' };
    }

    var highest = matches[0];

    for (var i = 1; i < matches.length; i++) {
      var current = matches[i];
      if ((SEVERITY_RANK[current.severity] || 0) > (SEVERITY_RANK[highest.severity] || 0)) {
        highest = current;
      }
    }

    return { severity: highest.severity, message: highest.message };
  }

  // -----------------------------------------------------------------------
  // Storage change listener
  // -----------------------------------------------------------------------

  function setupStorageListener() {
    try {
      chrome.storage.onChanged.addListener(function (changes, areaName) {
        if (areaName !== 'local') return;

        if (
          changes.sourcefence_location_rules ||
          changes.sourcefence_company_rules
        ) {
          loadRules();
        }
      });
    } catch (err) {
      console.warn('[SourceFence] Could not register storage listener:', err);
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Initialize the matcher: load rules from storage and register the
   * storage change listener.
   * @returns {Promise<void>}
   */
  function init() {
    setupStorageListener();
    return loadRules();
  }

  /**
   * Main entry point.  Checks a candidate's location and company against
   * all active rules, returns the highest-severity match, notifies the
   * banner, and sends the result to the service worker.
   *
   * @param {{ location: string, company: string }} candidate
   * @returns {Promise<{ severity: string, message: string }>}
   */
  function checkCandidate(candidate) {
    candidate = candidate || {};

    // Ensure rules have been loaded before matching
    var ready = rulesLoaded ? Promise.resolve() : loadRules();

    return ready.then(function () {
      var locationMatches = matchLocation(candidate.location, locationRules);
      var companyMatches = matchCompany(candidate.company, companyRules);

      var allMatches = locationMatches.concat(companyMatches);
      var result = resolveHighestSeverity(allMatches);

      // Notify the on-page banner
      if (window.SourceFenceBanner && typeof window.SourceFenceBanner.show === 'function') {
        window.SourceFenceBanner.show(result);
      }

      // Notify the background service worker
      try {
        chrome.runtime.sendMessage({ type: 'MATCH_RESULT', data: result });
      } catch (err) {
        console.warn('[SourceFence] Could not send message to service worker:', err);
      }

      return result;
    });
  }

  // -----------------------------------------------------------------------
  // Expose on window and auto-initialize
  // -----------------------------------------------------------------------

  /**
   * Match-only variant that does NOT trigger the banner or send messages.
   * Used by the search-annotator to check candidates without side effects.
   *
   * @param {{ location: string, company: string }} candidate
   * @returns {Promise<{ severity: string, message: string }>}
   */
  function matchOnly(candidate) {
    candidate = candidate || {};
    var ready = rulesLoaded ? Promise.resolve() : loadRules();

    return ready.then(function () {
      var locationMatches = matchLocation(candidate.location, locationRules);
      var companyMatches = matchCompany(candidate.company, companyRules);
      return resolveHighestSeverity(locationMatches.concat(companyMatches));
    });
  }

  window.SourceFenceMatcher = {
    init: init,
    checkCandidate: checkCandidate,
    matchOnly: matchOnly,
    // Exposed for testability — not part of the public contract
    _matchLocation: matchLocation,
    _matchCompany: matchCompany,
    _normalize: normalize,
    _normalizeCompanyName: normalizeCompanyName,
    _resolveHighestSeverity: resolveHighestSeverity,
    _isExpired: isExpired
  };

  // Listen for messages from service worker / popup
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (message) {
      if (message && message.type === 'RULES_UPDATED') {
        loadRules();
      }
    });
  }

  // Auto-initialize on load
  init();
})();
