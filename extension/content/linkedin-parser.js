/**
 * SourceFence — LinkedIn DOM Parser
 *
 * Extracts candidate location and current employer from LinkedIn profile pages.
 * Supports Standard (/in/), Recruiter (/talent/), and Sales Navigator (/sales/) variants.
 *
 * Uses a hybrid parsing strategy: multi-layer selector chains with text-walking fallbacks.
 * Designed for resilience — LinkedIn DOM changes frequently, so every extraction path
 * degrades gracefully through multiple fallback strategies.
 *
 * This file is loaded as a content script on LinkedIn profile pages (see manifest.json).
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Selector configuration — plain object so it can be updated without rebuild
  // ---------------------------------------------------------------------------

  const SELECTORS = {
    standard: {
      location: [
        // Priority 1: data-testid
        '[data-testid="profile-location"]',
        // Priority 2: ARIA
        '[aria-label*="location" i]',
        // Priority 3: Semantic class patterns — top card location line
        '.text-body-small.inline.t-black--light.break-words',
        '.pv-text-details__left-panel .text-body-small',
        // Priority 4: Structural — span near connections/followers in top card
        '.top-card-layout__first-subline .top-card__subline-item',
        '.ph5 .text-body-small.inline',
      ],
      headline: [
        '[data-testid="profile-headline"]',
        '.text-body-medium.break-words',
        '.pv-text-details__left-panel .text-body-medium',
        '.top-card-layout__headline',
        'h2.top-card-layout__headline',
      ],
      company: [
        // Priority 1: Experience section data-testid
        '[data-testid="experience-item"]',
        '[data-testid="experience-item-title"]',
        // Priority 2: ARIA — experience section
        'section[aria-label*="experience" i] .pvs-list li:first-child',
        '#experience ~ .pvs-list__outer-container .pvs-list li:first-child',
        // Priority 3: Semantic class — experience section first child
        '.experience-section .pv-entity__secondary-title',
        '.pvs-list .pvs-entity--padded:first-child .t-bold span[aria-hidden="true"]',
        // Priority 4: Broader experience list patterns
        '.pvs-list__paged-list-wrapper li:first-child .t-14.t-normal span[aria-hidden="true"]',
        '.pvs-list__paged-list-wrapper li:first-child .t-bold span[aria-hidden="true"]',
      ],
    },

    recruiter: {
      location: [
        '[data-testid="profile-location"]',
        '[data-test-profile-location]',
        '.profile-info__location',
        '.profile-location',
        '.topcard__location',
        // New Recruiter slide-in: metadata line in topcard (scoped in textWalkForLocation)
        '.profile-slidein__container .artdeco-entity-lockup__metadata',
        '.profile-detail .artdeco-entity-lockup__metadata',
        '.profile-detail .location',
        '.profile-topcard__location-data',
        // Broader patterns
        '.topcard-profile-info__location',
        '.profile-detail__location',
      ],
      headline: [
        '[data-testid="profile-headline"]',
        '.profile-info__headline',
        '.profile-headline',
        '.topcard__headline',
        '.profile-topcard__headline',
        // Broader patterns for newer Recruiter UI
        '.artdeco-entity-lockup__subtitle',
        '.profile-card__headline',
        '.topcard-profile-info__headline',
        '.profile-detail__headline',
        'h2.profile-topcard__title + *', // element after name
      ],
      company: [
        '[data-testid="experience-item"]',
        '.profile-info__current-company',
        '.profile-position__company-name',
        '.topcard__current-positions .topcard__position-info',
        '.profile-topcard__current-positions .profile-topcard__summary-position',
        '.experience-section .position-entity__company-name',
        '.profile-detail .experience .company-name',
      ],
    },

    salesNav: {
      location: [
        '[data-testid="profile-location"]',
        '[data-anonymize="location"]',
        '.profile-topcard__location-data',
        '.profile-topcard-person-entity__location',
        '.artdeco-entity-lockup__metadata',
        '._bodyText_1e5nen',
        '.profile-location',
      ],
      headline: [
        '[data-testid="profile-headline"]',
        '[data-anonymize="headline"]',
        '.profile-topcard__headline',
        '.profile-topcard-person-entity__headline',
        '.artdeco-entity-lockup__subtitle',
        '._headlineText_1e5nen',
      ],
      company: [
        '[data-testid="experience-item"]',
        '[data-anonymize="company-name"]',
        '.profile-topcard__summary-position-company',
        '.profile-topcard-person-entity__company',
        '.experience-section .company-name',
        '._companyName_1e5nen',
        '.profile-topcard__current-positions .profile-topcard__summary-position',
      ],
    },
  };

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  var DEBOUNCE_DELAY = 300;
  var URL_POLL_INTERVAL = 1000;
  var PROFILE_URL_PATTERNS = ['/in/', '/talent/', '/sales/'];

  // ---------------------------------------------------------------------------
  // LinkedInParser
  // ---------------------------------------------------------------------------

  var LinkedInParser = {
    /** @type {MutationObserver|null} */
    _observer: null,

    /** @type {number|null} */
    _urlPollTimer: null,

    /** @type {string|null} */
    _lastUrl: null,

    /** @type {{ location: string|null, company: string|null }|null} */
    _lastParsedData: null,

    /** @type {Function|null} */
    _debouncedParse: null,

    /** @type {boolean} */
    _initialized: false,

    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    /**
     * Initialize the parser. Sets up MutationObserver, URL polling, and
     * popstate listener.
     */
    init: function () {
      try {
        if (this._initialized) {
          return;
        }

        if (!this._isProfilePage()) {
          // Not a profile page — start URL polling only so we detect SPA navigation into one
          this._startUrlPolling();
          this._initialized = true;
          return;
        }

        this._lastUrl = window.location.href;
        this._debouncedParse = this.debounce(this.parse.bind(this), DEBOUNCE_DELAY);

        // MutationObserver on document.body
        this._observer = new MutationObserver(this._onMutation.bind(this));
        this._observer.observe(document.body, {
          childList: true,
          subtree: true,
        });

        // Listen for popstate (back/forward navigation)
        window.addEventListener('popstate', this._onPopState.bind(this));

        // URL polling — LinkedIn SPA does not always fire popstate
        this._startUrlPolling();

        // Initial parse
        this._debouncedParse();

        this._initialized = true;
      } catch (err) {
        console.warn('[SourceFence] LinkedInParser.init failed:', err);
      }
    },

    /**
     * Tear down all observers and timers.
     */
    destroy: function () {
      try {
        if (this._observer) {
          this._observer.disconnect();
          this._observer = null;
        }
        if (this._urlPollTimer) {
          clearInterval(this._urlPollTimer);
          this._urlPollTimer = null;
        }
        window.removeEventListener('popstate', this._onPopState.bind(this));
        this._initialized = false;
        this._lastUrl = null;
        this._lastParsedData = null;
        this._debouncedParse = null;
      } catch (err) {
        console.warn('[SourceFence] LinkedInParser.destroy failed:', err);
      }
    },

    // -----------------------------------------------------------------------
    // URL & Navigation
    // -----------------------------------------------------------------------

    /**
     * Returns true if the current URL is a LinkedIn profile page.
     * @returns {boolean}
     */
    _isProfilePage: function () {
      var href = window.location.href;
      for (var i = 0; i < PROFILE_URL_PATTERNS.length; i++) {
        if (href.indexOf(PROFILE_URL_PATTERNS[i]) !== -1) {
          return true;
        }
      }
      return false;
    },

    /**
     * Detects which LinkedIn variant we are on.
     * @returns {'standard'|'recruiter'|'salesNav'|null}
     */
    _detectVariant: function () {
      var path = window.location.pathname;
      var url = window.location.href;

      // Profile pages — detect these BEFORE search exclusions
      // Recruiter profile URLs: /talent/profile/ACw..., /talent/hire/ACw.../profile
      // Side panel URLs: /talent/search/profile/AEM...
      if (path.indexOf('/talent/profile') !== -1 ||
          path.indexOf('/talent/search/profile') !== -1) {
        return 'recruiter';
      }

      // Skip search/list pages — handled by search-annotator.js
      if (url.indexOf('/talent/search') !== -1 ||
          url.indexOf('/talent/hire/search') !== -1 ||
          url.indexOf('/sales/search') !== -1 ||
          url.indexOf('/search/results') !== -1) {
        return null;
      }

      if (path.indexOf('/talent/') !== -1) {
        return 'recruiter';
      }
      if (path.indexOf('/sales/') !== -1) {
        return 'salesNav';
      }
      if (path.indexOf('/in/') !== -1) {
        return 'standard';
      }
      return null;
    },

    /**
     * Start polling the URL every URL_POLL_INTERVAL ms to detect SPA navigation.
     */
    _startUrlPolling: function () {
      var self = this;
      if (this._urlPollTimer) {
        return;
      }
      this._urlPollTimer = setInterval(function () {
        try {
          self._checkUrlChange();
        } catch (err) {
          console.warn('[SourceFence] URL poll error:', err);
        }
      }, URL_POLL_INTERVAL);
    },

    /**
     * Compare current URL to last known URL. If changed, re-initialize/parse.
     */
    _checkUrlChange: function () {
      var currentUrl = window.location.href;
      if (currentUrl !== this._lastUrl) {
        this._lastUrl = currentUrl;
        this._lastParsedData = null;

        if (this._isProfilePage()) {
          // If we were not initialized (started on non-profile page), do full init
          if (!this._observer) {
            this._initialized = false;
            this.init();
          } else if (this._debouncedParse) {
            this._debouncedParse();
          }
        }
      }
    },

    /**
     * Handler for popstate events (browser back/forward).
     */
    _onPopState: function () {
      try {
        this._checkUrlChange();
      } catch (err) {
        console.warn('[SourceFence] popstate handler error:', err);
      }
    },

    /**
     * Handler for MutationObserver callbacks.
     */
    _onMutation: function () {
      try {
        if (this._isProfilePage() && this._debouncedParse) {
          this._debouncedParse();
        }
      } catch (err) {
        console.warn('[SourceFence] MutationObserver callback error:', err);
      }
    },

    // -----------------------------------------------------------------------
    // Parsing Orchestration
    // -----------------------------------------------------------------------

    /**
     * Main parse entry point. Detects the LinkedIn variant and dispatches
     * to the appropriate parser.
     */
    parse: function () {
      try {
        var variant = this._detectVariant();
        if (!variant) {
          return;
        }

        var result = null;

        switch (variant) {
          case 'standard':
            result = this.parseStandardProfile();
            break;
          case 'recruiter':
            result = this.parseRecruiterProfile();
            break;
          case 'salesNav':
            result = this.parseSalesNavProfile();
            break;
          default:
            return;
        }

        if (!result) {
          return;
        }

        var location = result.location || null;
        var company = result.company || null;

        // Avoid re-processing the exact same data for the same URL
        if (
          this._lastParsedData &&
          this._lastParsedData.status === 'success' &&
          this._lastParsedData.location === location &&
          this._lastParsedData.company === company
        ) {
          return;
        }

        // If both fields are null, report failure
        if (location === null && company === null) {
          this._lastParsedData = { status: 'failed', url: window.location.href };
          this._reportFailure();
          return;
        }

        this._lastParsedData = { status: 'success', location: location, company: company, url: window.location.href };

        // Report success and invoke the matcher
        this._reportSuccess(location, company);
        this._invokeMatcher(location, company);
      } catch (err) {
        console.warn('[SourceFence] parse() error:', err);
        this._reportFailure();
      }
    },

    /**
     * Parse a standard LinkedIn profile (/in/).
     * @returns {{ location: string|null, company: string|null }}
     */
    parseStandardProfile: function () {
      try {
        var location = this.extractLocation('standard');
        var company = this.extractCompany('standard');
        return { location: location, company: company };
      } catch (err) {
        console.warn('[SourceFence] parseStandardProfile error:', err);
        return { location: null, company: null };
      }
    },

    /**
     * Parse a LinkedIn Recruiter profile (/talent/).
     * @returns {{ location: string|null, company: string|null }}
     */
    parseRecruiterProfile: function () {
      try {
        var location = this.extractLocation('recruiter');
        var company = this.extractCompany('recruiter');
        return { location: location, company: company };
      } catch (err) {
        console.warn('[SourceFence] parseRecruiterProfile error:', err);
        return { location: null, company: null };
      }
    },

    /**
     * Parse a Sales Navigator profile (/sales/).
     * @returns {{ location: string|null, company: string|null }}
     */
    parseSalesNavProfile: function () {
      try {
        var location = this.extractLocation('salesNav');
        var company = this.extractCompany('salesNav');
        return { location: location, company: company };
      } catch (err) {
        console.warn('[SourceFence] parseSalesNavProfile error:', err);
        return { location: null, company: null };
      }
    },

    // -----------------------------------------------------------------------
    // Location Extraction
    // -----------------------------------------------------------------------

    /**
     * Extract location from the page using the selector chain for the given variant.
     * Falls back to text walking if all selectors fail.
     *
     * @param {'standard'|'recruiter'|'salesNav'} variant
     * @returns {string|null}
     */
    extractLocation: function (variant) {
      try {
        var selectors = SELECTORS[variant] && SELECTORS[variant].location;
        if (!selectors) {
          return this.textWalkForLocation();
        }

        for (var i = 0; i < selectors.length; i++) {
          try {
            var el = document.querySelector(selectors[i]);
            if (el) {
              var text = this._cleanText(el.textContent);
              if (text && this._looksLikeLocation(text)) {
                return text;
              }
            }
          } catch (selectorErr) {
            // Individual selector failed (e.g., invalid selector) — skip it
            console.warn(
              '[SourceFence] Location selector failed: "' + selectors[i] + '"',
              selectorErr
            );
          }
        }

        // Try dt/dd definition-list extraction (new Recruiter UI)
        var dlLocation = this._extractLocationFromDefinitionList();
        if (dlLocation) {
          return dlLocation;
        }

        // All strategies exhausted — try text walking
        return this.textWalkForLocation();
      } catch (err) {
        console.warn('[SourceFence] extractLocation error:', err);
        return null;
      }
    },

    /**
     * Extract location from Recruiter's definition-list UI.
     * Finds <dt>Position location</dt><dd>London, UK</dd> in the current
     * experience entry (the one whose dates contain "Present").
     *
     * @returns {string|null}
     */
    _extractLocationFromDefinitionList: function () {
      try {
        var allDts = document.querySelectorAll('dt');
        // Find "Position location" dts that are in an experience entry with "Present"
        for (var i = 0; i < allDts.length; i++) {
          var dtText = allDts[i].textContent.trim();
          if (dtText !== 'Position location') {
            continue;
          }

          // Check if the same parent dl has a "Dates" entry containing "Present"
          var parent = allDts[i].parentElement;
          if (!parent) {
            continue;
          }
          var siblingDts = parent.querySelectorAll('dt');
          var hasPresentDate = false;
          for (var d = 0; d < siblingDts.length; d++) {
            if (siblingDts[d].textContent.trim().indexOf('Dates') !== -1) {
              var datesDd = siblingDts[d].nextElementSibling;
              if (datesDd && /\bPresent\b/i.test(datesDd.textContent)) {
                hasPresentDate = true;
                break;
              }
            }
          }

          if (hasPresentDate) {
            var locationDd = allDts[i].nextElementSibling;
            if (locationDd && locationDd.tagName === 'DD') {
              var locText = this._cleanText(locationDd.textContent);
              if (locText && locText.length > 1 && locText.length < 100) {
                return locText;
              }
            }
          }
        }

        return null;
      } catch (err) {
        console.warn('[SourceFence] _extractLocationFromDefinitionList error:', err);
        return null;
      }
    },

    /**
     * Text-walking fallback for location extraction.
     * Walks the DOM looking for location-related headings and grabs adjacent text.
     *
     * @returns {string|null}
     */
    textWalkForLocation: function () {
      try {
        // Strategy 1: Look for a section heading or label containing "Location"
        var headings = document.querySelectorAll(
          'h1, h2, h3, h4, h5, h6, span, div, dt, label'
        );
        for (var i = 0; i < headings.length; i++) {
          var heading = headings[i];
          var headingText = this._cleanText(heading.textContent);
          if (headingText && headingText.toLowerCase() === 'location') {
            // Check next sibling, parent's next sibling, or following dd element
            var adjacent = this._getAdjacentText(heading);
            if (adjacent && this._looksLikeLocation(adjacent)) {
              return adjacent;
            }
          }
        }

        // Strategy 2: Look for elements whose aria-label contains "location"
        var ariaEls = document.querySelectorAll('[aria-label]');
        for (var j = 0; j < ariaEls.length; j++) {
          var ariaLabel = ariaEls[j].getAttribute('aria-label');
          if (ariaLabel && ariaLabel.toLowerCase().indexOf('location') !== -1) {
            var text = this._cleanText(ariaEls[j].textContent);
            if (text && this._looksLikeLocation(text)) {
              return text;
            }
          }
        }

        // Strategy 3: Search the top card area for short text that looks like a location
        var topCard =
          document.querySelector('.pv-top-card') ||
          document.querySelector('.profile-topcard') ||
          document.querySelector('.topcard') ||
          document.querySelector('main section:first-child');

        if (topCard) {
          var spans = topCard.querySelectorAll('span, div');
          for (var k = 0; k < spans.length; k++) {
            var spanText = this._cleanText(spans[k].textContent);
            if (
              spanText &&
              spanText.length > 2 &&
              spanText.length < 100 &&
              this._looksLikeLocation(spanText) &&
              !this._looksLikeHeadline(spanText)
            ) {
              return spanText;
            }
          }
        }

        console.warn('[SourceFence] textWalkForLocation: no location found');
        return null;
      } catch (err) {
        console.warn('[SourceFence] textWalkForLocation error:', err);
        return null;
      }
    },

    // -----------------------------------------------------------------------
    // Company Extraction
    // -----------------------------------------------------------------------

    /**
     * Extract current employer from the page using the selector chain for the
     * given variant. Falls back to headline parsing and text walking.
     *
     * @param {'standard'|'recruiter'|'salesNav'} variant
     * @returns {string|null}
     */
    extractCompany: function (variant) {
      try {
        // Strategy 1: Parse company from headline text ("Engineer at Acme")
        var headlineCompany = this._extractCompanyFromHeadline(variant);
        if (headlineCompany) {
          return headlineCompany;
        }

        // Strategy 2: Walk through experience/company selectors
        var selectors = SELECTORS[variant] && SELECTORS[variant].company;
        if (selectors) {
          for (var i = 0; i < selectors.length; i++) {
            try {
              var el = document.querySelector(selectors[i]);
              if (el) {
                var text = this._extractCompanyName(el);
                if (text) {
                  return text;
                }
              }
            } catch (selectorErr) {
              console.warn(
                '[SourceFence] Company selector failed: "' + selectors[i] + '"',
                selectorErr
              );
            }
          }
        }

        // Strategy 3: Recruiter dt/dd definition-list extraction
        // New Recruiter UI uses <dt>Company name</dt><dd>Meta</dd> inside <dl> elements
        var dtCompany = this._extractCompanyFromDefinitionList();
        if (dtCompany) {
          return dtCompany;
        }

        // Strategy 4: Text walking fallback
        return this.textWalkForCompany();
      } catch (err) {
        console.warn('[SourceFence] extractCompany error:', err);
        return null;
      }
    },

    /**
     * Extract the current employer from Recruiter's definition-list UI.
     * The new Recruiter layout uses <dt>Company name</dt><dd>Meta</dd> pairs
     * inside experience entries. We find the first entry whose dates contain
     * "Present" (indicating current employment) and return its company name.
     *
     * @returns {string|null}
     */
    _extractCompanyFromDefinitionList: function () {
      try {
        var allDts = document.querySelectorAll('dt');
        // Group dt/dd pairs by their closest common ancestor (each experience entry)
        // Strategy: find "Company name" dts, then check sibling "Dates employed" for "Present"
        var companyDts = [];
        for (var i = 0; i < allDts.length; i++) {
          if (allDts[i].textContent.trim() === 'Company name') {
            companyDts.push(allDts[i]);
          }
        }

        if (companyDts.length === 0) {
          return null;
        }

        for (var c = 0; c < companyDts.length; c++) {
          var companyDt = companyDts[c];
          var companyDd = companyDt.nextElementSibling;
          if (!companyDd || companyDd.tagName !== 'DD') {
            continue;
          }

          // Walk sibling dts in the same parent (dl) to find the dates entry
          var parent = companyDt.parentElement;
          if (!parent) {
            continue;
          }
          var siblingDts = parent.querySelectorAll('dt');
          var hasPresentDate = false;
          for (var d = 0; d < siblingDts.length; d++) {
            if (siblingDts[d].textContent.trim().indexOf('Dates') !== -1) {
              var datesDd = siblingDts[d].nextElementSibling;
              if (datesDd && /\bPresent\b/i.test(datesDd.textContent)) {
                hasPresentDate = true;
                break;
              }
            }
          }

          if (hasPresentDate) {
            // Extract company name from dd — the link may contain search-highlight
            // tooltip text like "Related to search terms in your query" appended to
            // the real company name, so try increasingly broad selectors:
            var companyText = null;

            // Try 1: text-highlighter__match span (contains just the company name,
            // without search tooltip text like "Related to search terms...")
            var highlighter = companyDd.querySelector('.text-highlighter__match') ||
                              companyDd.querySelector('.text-highlighter span');
            if (highlighter) {
              companyText = this._cleanText(highlighter.textContent);
            }

            // Try 2: company link with data-test attribute (strip noise text)
            if (!companyText) {
              var companyLink = companyDd.querySelector('a[data-test-position-entity-company-link]') ||
                                companyDd.querySelector('a');
              if (companyLink) {
                var raw = this._cleanText(companyLink.textContent);
                // Strip "Related to search terms..." tooltip noise
                companyText = raw.replace(/\s*Related to search terms.*$/i, '').trim();
              }
            }

            // Try 3: dd text directly
            if (!companyText) {
              companyText = this._cleanText(companyDd.textContent)
                .replace(/\s*Related to search terms.*$/i, '').trim();
            }

            if (companyText && companyText.length > 1 && companyText.length < 100) {
              return this._cleanCompanyText(companyText);
            }
          }
        }

        return null;
      } catch (err) {
        console.warn('[SourceFence] _extractCompanyFromDefinitionList error:', err);
        return null;
      }
    },

    /**
     * Try to extract the company name from the profile headline.
     * Looks for patterns like "Title at Company" or "Title | Company".
     *
     * @param {'standard'|'recruiter'|'salesNav'} variant
     * @returns {string|null}
     */
    _extractCompanyFromHeadline: function (variant) {
      try {
        var headlineSelectors = SELECTORS[variant] && SELECTORS[variant].headline;
        if (!headlineSelectors) {
          return null;
        }

        var headlineText = null;

        for (var i = 0; i < headlineSelectors.length; i++) {
          try {
            var el = document.querySelector(headlineSelectors[i]);
            if (el) {
              headlineText = this._cleanText(el.textContent);
              if (headlineText) {
                break;
              }
            }
          } catch (e) {
            // Skip bad selector
          }
        }

        if (!headlineText) {
          return null;
        }

        return this._parseCompanyFromHeadline(headlineText);
      } catch (err) {
        console.warn('[SourceFence] _extractCompanyFromHeadline error:', err);
        return null;
      }
    },

    /**
     * Parse a company name from a headline string.
     * Supports patterns: "at Company", "@ Company", "| Company", "- Company".
     *
     * @param {string} headline
     * @returns {string|null}
     */
    _parseCompanyFromHeadline: function (headline) {
      if (!headline) {
        return null;
      }

      // Pattern 1: "... at Company" (most common)
      // Use word boundary before "at" to avoid matching words ending in "at"
      var atMatch = headline.match(/\bat\s+(.+?)(?:\s*[|\-]|$)/i);
      if (atMatch && atMatch[1]) {
        var company = this._cleanText(atMatch[1]);
        if (company && company.length > 1 && company.length < 100) {
          return company;
        }
      }

      // Pattern 2: "... @ Company"
      var atSymMatch = headline.match(/@\s*(.+?)(?:\s*[|\-]|$)/);
      if (atSymMatch && atSymMatch[1]) {
        var company2 = this._cleanText(atSymMatch[1]);
        if (company2 && company2.length > 1 && company2.length < 100) {
          return company2;
        }
      }

      // Pattern 3: "Title | Company" or "Title - Company" (take last segment)
      var pipeMatch = headline.match(/[|\-]\s*([^|\-]+)\s*$/);
      if (pipeMatch && pipeMatch[1]) {
        var segment = this._cleanText(pipeMatch[1]);
        // Only use if it looks like a company name (not a title/role)
        if (
          segment &&
          segment.length > 1 &&
          segment.length < 100 &&
          !this._looksLikeJobTitle(segment)
        ) {
          return segment;
        }
      }

      return null;
    },

    /**
     * Text-walking fallback for company/employer extraction.
     * Walks the DOM looking for "Experience" headings and extracts the first
     * company name from the entries below.
     *
     * @returns {string|null}
     */
    textWalkForCompany: function () {
      try {
        // Strategy 1: Find "Experience" section heading and extract first company
        var headings = document.querySelectorAll(
          'h1, h2, h3, h4, h5, h6, span, div, section'
        );
        for (var i = 0; i < headings.length; i++) {
          var heading = headings[i];
          var headingText = this._cleanText(heading.textContent);

          // Skip elements with too much text (they are containers, not headings)
          if (!headingText || headingText.length > 30) {
            continue;
          }

          if (headingText.toLowerCase() === 'experience') {
            // Look for the experience list in the parent section
            var section =
              heading.closest('section') || heading.parentElement;
            if (section) {
              var companyName = this._extractFirstCompanyFromSection(section);
              if (companyName) {
                return companyName;
              }
            }
          }
        }

        // Strategy 2: Look for elements with aria-label containing "experience"
        var sections = document.querySelectorAll('section[aria-label]');
        for (var j = 0; j < sections.length; j++) {
          var label = sections[j].getAttribute('aria-label');
          if (label && label.toLowerCase().indexOf('experience') !== -1) {
            var company = this._extractFirstCompanyFromSection(sections[j]);
            if (company) {
              return company;
            }
          }
        }

        // Strategy 3: Look for the experience section by ID
        var expById = document.getElementById('experience');
        if (expById) {
          var parentSection = expById.closest('section') || expById.parentElement;
          if (parentSection) {
            var companyFromId = this._extractFirstCompanyFromSection(parentSection);
            if (companyFromId) {
              return companyFromId;
            }
          }
        }

        // Strategy 4: Recruiter profiles — look for headline text containing "at"
        // in the top-card area
        var topArea = document.querySelector('.profile-topcard, .topcard, .profile-detail, main > section:first-child, .profile-card');
        if (topArea) {
          var elements = topArea.querySelectorAll('span, div, p, h2, h3');
          for (var m = 0; m < elements.length; m++) {
            var elText = this._cleanText(elements[m].textContent);
            if (elText && elText.length > 5 && elText.length < 200) {
              var parsedCompany = this._parseCompanyFromHeadline(elText);
              if (parsedCompany) {
                return parsedCompany;
              }
            }
          }
        }

        console.warn('[SourceFence] textWalkForCompany: no company found');
        return null;
      } catch (err) {
        console.warn('[SourceFence] textWalkForCompany error:', err);
        return null;
      }
    },

    /**
     * Extract the first company name from an experience section element.
     * Looks for list items and tries to find the company name within them.
     *
     * @param {Element} section
     * @returns {string|null}
     */
    _extractFirstCompanyFromSection: function (section) {
      try {
        // Look for list items in the section
        var listItems = section.querySelectorAll('li');
        if (listItems.length === 0) {
          // No list items — try direct child divs
          listItems = section.querySelectorAll('.pvs-entity--padded, [data-view-name]');
        }

        if (listItems.length === 0) {
          return null;
        }

        // Find the first CURRENT position (contains "Present")
        var targetItem = null;
        for (var idx = 0; idx < listItems.length; idx++) {
          var itemText = listItems[idx].textContent || '';
          if (/\bPresent\b/i.test(itemText)) {
            targetItem = listItems[idx];
            break;
          }
        }

        // If no current position found, don't guess — only flag current employers
        if (!targetItem) {
          return null;
        }

        // Try to find company name in the target experience entry
        // LinkedIn often puts the company name in a secondary text element
        var companyEl =
          targetItem.querySelector('.t-14.t-normal span[aria-hidden="true"]') ||
          targetItem.querySelector('.pv-entity__secondary-title') ||
          targetItem.querySelector('[data-testid="experience-item-company"]') ||
          targetItem.querySelector('.t-bold span[aria-hidden="true"]');

        if (companyEl) {
          var text = this._cleanText(companyEl.textContent);
          if (text && text.length > 1 && text.length < 100) {
            // Strip common prefixes like "Full-time" or date ranges
            return this._cleanCompanyText(text);
          }
        }

        // Broader fallback: look for any span with aria-hidden in the target item
        var spans = targetItem.querySelectorAll('span[aria-hidden="true"]');
        for (var i = 0; i < spans.length; i++) {
          var spanText = this._cleanText(spans[i].textContent);
          if (
            spanText &&
            spanText.length > 1 &&
            spanText.length < 100 &&
            !this._looksLikeDateRange(spanText) &&
            !this._looksLikeJobTitle(spanText)
          ) {
            return this._cleanCompanyText(spanText);
          }
        }

        return null;
      } catch (err) {
        console.warn('[SourceFence] _extractFirstCompanyFromSection error:', err);
        return null;
      }
    },

    // -----------------------------------------------------------------------
    // Helpers — Text Cleaning & Heuristics
    // -----------------------------------------------------------------------

    /**
     * Clean extracted text: trim whitespace, collapse internal whitespace,
     * strip zero-width characters.
     *
     * @param {string|null|undefined} text
     * @returns {string}
     */
    _cleanText: function (text) {
      if (!text) {
        return '';
      }
      return text
        .replace(/[\u200B\u200C\u200D\uFEFF]/g, '') // Zero-width chars
        .replace(/\s+/g, ' ') // Collapse whitespace
        .trim();
    },

    /**
     * Clean company text: remove leading employment type indicators and other noise.
     *
     * @param {string} text
     * @returns {string}
     */
    _cleanCompanyText: function (text) {
      if (!text) {
        return '';
      }
      // Remove common noise patterns that appear alongside company names
      return text
        .replace(
          /^(Full-time|Part-time|Contract|Freelance|Self-employed|Internship|Seasonal|Apprenticeship)\s*[\-\u00B7\u2022]?\s*/i,
          ''
        )
        .replace(/\s*[\-\u00B7\u2022]\s*(Full-time|Part-time|Contract|Freelance|Self-employed|Internship|Seasonal|Apprenticeship)\s*$/i, '')
        .trim();
    },

    /**
     * Heuristic: does this text look like a location?
     * Checks for comma-separated parts, known patterns, and length.
     *
     * @param {string} text
     * @returns {boolean}
     */
    _looksLikeLocation: function (text) {
      if (!text || text.length < 2 || text.length > 200) {
        return false;
      }

      // Reject if it has too many words (likely a paragraph, not a location)
      var wordCount = text.split(/\s+/).length;
      if (wordCount > 12) {
        return false;
      }

      // Location patterns: "City, State", "City, Country", "Area Name"
      // Most locations have a comma or contain words like Area, Region, etc.
      var locationPatterns = [
        /,/, // "San Francisco, California"
        /\barea\b/i, // "Greater San Francisco Bay Area"
        /\bregion\b/i, // "Lombardy Region"
        /\bdistrict\b/i,
        /\bcity\b/i,
        /\bstate\b/i,
        /\bprovince\b/i,
        /\bcounty\b/i,
        /\bmetro\b/i,
        /\bgreater\b/i, // "Greater London"
      ];

      for (var i = 0; i < locationPatterns.length; i++) {
        if (locationPatterns[i].test(text)) {
          return true;
        }
      }

      // Short text (1-5 words) without common non-location indicators is acceptable
      // as a location — could be "London" or "New York"
      if (wordCount <= 5) {
        // Reject if it looks like a job title
        if (this._looksLikeJobTitle(text)) {
          return false;
        }
        // Reject if it is a number or mostly numbers
        if (/^\d[\d,.\s]*$/.test(text)) {
          return false;
        }
        return true;
      }

      return false;
    },

    /**
     * Heuristic: does this text look like a headline (title + company)?
     *
     * @param {string} text
     * @returns {boolean}
     */
    _looksLikeHeadline: function (text) {
      if (!text) {
        return false;
      }
      return /\b(at|@)\s+\S/i.test(text) || /[|\-]\s*\S/.test(text);
    },

    /**
     * Heuristic: does this text look like a job title?
     *
     * @param {string} text
     * @returns {boolean}
     */
    _looksLikeJobTitle: function (text) {
      if (!text) {
        return false;
      }
      var lower = text.toLowerCase();
      var titleWords = [
        'engineer',
        'developer',
        'manager',
        'director',
        'president',
        'officer',
        'analyst',
        'designer',
        'consultant',
        'specialist',
        'coordinator',
        'administrator',
        'architect',
        'recruiter',
        'lead',
        'head of',
        'vp ',
        'vice president',
        'ceo',
        'cto',
        'cfo',
        'coo',
        'founder',
        'co-founder',
        'intern',
        'associate',
        'senior',
        'junior',
        'principal',
        'staff',
      ];
      for (var i = 0; i < titleWords.length; i++) {
        if (lower.indexOf(titleWords[i]) !== -1) {
          return true;
        }
      }
      return false;
    },

    /**
     * Heuristic: does this text look like a date range?
     * e.g., "Jan 2020 - Present", "2019 - 2022", "3 yrs 2 mos"
     *
     * @param {string} text
     * @returns {boolean}
     */
    _looksLikeDateRange: function (text) {
      if (!text) {
        return false;
      }
      return (
        /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(text) ||
        /\b(present)\b/i.test(text) ||
        /\b\d{4}\s*[-\u2013]\s*(\d{4}|present)\b/i.test(text) ||
        /\b\d+\s*(yr|yrs|mos?|month|year)\b/i.test(text)
      );
    },

    /**
     * Get the text content adjacent to a given element.
     * Tries: nextElementSibling, next sibling text node, parent's next element,
     * and following dd element (for dt/dd pairs).
     *
     * @param {Element} el
     * @returns {string}
     */
    _getAdjacentText: function (el) {
      // Try next element sibling
      if (el.nextElementSibling) {
        var text = this._cleanText(el.nextElementSibling.textContent);
        if (text) {
          return text;
        }
      }

      // Try next sibling node (could be a text node)
      if (el.nextSibling && el.nextSibling.nodeType === Node.TEXT_NODE) {
        var sibText = this._cleanText(el.nextSibling.textContent);
        if (sibText) {
          return sibText;
        }
      }

      // For dt/dd pairs
      if (el.tagName === 'DT' || el.tagName === 'LABEL') {
        var dd = el.nextElementSibling;
        if (dd && (dd.tagName === 'DD' || dd.tagName === 'SPAN' || dd.tagName === 'DIV')) {
          var ddText = this._cleanText(dd.textContent);
          if (ddText) {
            return ddText;
          }
        }
      }

      // Try parent's next element
      if (el.parentElement && el.parentElement.nextElementSibling) {
        var parentNext = this._cleanText(
          el.parentElement.nextElementSibling.textContent
        );
        if (parentNext) {
          return parentNext;
        }
      }

      return '';
    },

    /**
     * Extract a company name from an element. Tries textContent of the element
     * itself, or looks for a child span with aria-hidden.
     *
     * @param {Element} el
     * @returns {string|null}
     */
    _extractCompanyName: function (el) {
      if (!el) {
        return null;
      }

      // First try a child with aria-hidden (LinkedIn pattern for visible text)
      var ariaSpan = el.querySelector('span[aria-hidden="true"]');
      if (ariaSpan) {
        var spanText = this._cleanText(ariaSpan.textContent);
        if (spanText && spanText.length > 1 && spanText.length < 100) {
          return this._cleanCompanyText(spanText);
        }
      }

      // Fall back to the element's own text
      var text = this._cleanText(el.textContent);
      if (text && text.length > 1 && text.length < 100) {
        return this._cleanCompanyText(text);
      }

      return null;
    },

    // -----------------------------------------------------------------------
    // Communication — Matcher & Service Worker
    // -----------------------------------------------------------------------

    /**
     * Invoke the SourceFence matcher with the extracted candidate data.
     *
     * @param {string|null} location
     * @param {string|null} company
     */
    _invokeMatcher: function (location, company) {
      try {
        if (
          typeof window.SourceFenceMatcher !== 'undefined' &&
          typeof window.SourceFenceMatcher.checkCandidate === 'function'
        ) {
          window.SourceFenceMatcher.checkCandidate({
            location: location,
            company: company,
          });
        } else {
          console.warn(
            '[SourceFence] SourceFenceMatcher not available — matcher.js may not be loaded yet'
          );
          // Retry after a short delay in case matcher hasn't loaded yet
          var self = this;
          setTimeout(function () {
            try {
              if (
                typeof window.SourceFenceMatcher !== 'undefined' &&
                typeof window.SourceFenceMatcher.checkCandidate === 'function'
              ) {
                window.SourceFenceMatcher.checkCandidate({
                  location: location,
                  company: company,
                });
              }
            } catch (retryErr) {
              console.warn('[SourceFence] Matcher retry failed:', retryErr);
            }
          }, 500);
        }
      } catch (err) {
        console.warn('[SourceFence] _invokeMatcher error:', err);
      }
    },

    /**
     * Report successful parse to the service worker.
     *
     * @param {string|null} location
     * @param {string|null} company
     */
    _reportSuccess: function (location, company) {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            type: 'PARSE_RESULT',
            data: {
              status: 'success',
              location: location,
              company: company,
              url: window.location.href,
            },
          });
        }
      } catch (err) {
        // sendMessage can fail if service worker is not available — this is not fatal
        console.warn('[SourceFence] _reportSuccess sendMessage error:', err);
      }
    },

    /**
     * Report parse failure to the service worker.
     */
    _reportFailure: function () {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({
            type: 'PARSE_RESULT',
            data: {
              status: 'failed',
              url: window.location.href,
            },
          });
        }
      } catch (err) {
        console.warn('[SourceFence] _reportFailure sendMessage error:', err);
      }
    },

    // -----------------------------------------------------------------------
    // Utilities
    // -----------------------------------------------------------------------

    /**
     * Create a debounced version of a function.
     *
     * @param {Function} fn
     * @param {number} delay — milliseconds
     * @returns {Function}
     */
    debounce: function (fn, delay) {
      var timer = null;
      return function () {
        var context = this;
        var args = arguments;
        if (timer) {
          clearTimeout(timer);
        }
        timer = setTimeout(function () {
          timer = null;
          fn.apply(context, args);
        }, delay);
      };
    },
  };

  // ---------------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------------

  // Wait for the DOM to be reasonably ready before initializing.
  // content scripts with run_at: document_idle will already have a loaded DOM,
  // but we add a safety check just in case.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      LinkedInParser.init();
    });
  } else {
    LinkedInParser.init();
  }

  // Expose the parser on window for inter-script communication and testing.
  // Other SourceFence content scripts (matcher, banner) can use this reference.
  window.SourceFenceParser = LinkedInParser;

  // ---------------------------------------------------------------------------
  // Message listeners — handle messages from service worker and popup
  // ---------------------------------------------------------------------------

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (!message || !message.type) return;

      switch (message.type) {
        case 'URL_CHANGED':
          // Service worker detected a URL change — re-parse
          LinkedInParser._checkUrlChange();
          break;

        case 'GET_STATUS':
          // Popup requesting current profile data
          sendResponse({
            type: 'PARSE_RESULT',
            data: LinkedInParser._lastParsedData || { status: 'no_data', url: window.location.href },
          });
          return true; // keep channel open for async sendResponse

        case 'RULES_UPDATED':
          // Rules changed — re-evaluate current profile
          if (LinkedInParser._lastParsedData && LinkedInParser._lastParsedData.status === 'success') {
            LinkedInParser._invokeMatcher(
              LinkedInParser._lastParsedData.location,
              LinkedInParser._lastParsedData.company
            );
          }
          break;
      }
    });
  }
})();
