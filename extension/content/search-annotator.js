/**
 * SourceFence — Search Results Annotator
 *
 * Injects per-candidate compliance badges on LinkedIn search result cards.
 * Works on: LinkedIn Recruiter search (/talent/), Sales Nav search (/sales/search),
 * and standard LinkedIn search (/search/).
 *
 * Each candidate card gets a small colored badge:
 *   Red pill:  "RESTRICTED" — candidate is in a blocked market/company
 *   Amber pill: "CAUTION" — candidate needs review
 *   Green:     No badge shown (don't clutter clean results)
 *
 * Uses MutationObserver to handle infinite scroll loading new cards.
 *
 * Card detection strategy:
 *   1. Try known CSS selectors for each LinkedIn product
 *   2. Broad class-name fallback
 *   3. Content-based fallback: find profile links, walk up DOM to card container
 *      (works regardless of class names — resilient to Recruiter redesigns)
 */
(function () {
  'use strict';

  var ANNOTATED_ATTR = 'data-sourcefence-annotated';
  var BADGE_CLASS = 'sourcefence-search-badge';
  var DEBOUNCE_MS = 500;
  var INITIAL_DELAY_MS = 2000;
  var RETRY_INTERVAL_MS = 3000;
  var MAX_RETRIES = 5;
  var retryCount = 0;
  var MIN_CARD_TEXT_LENGTH = 50; // cards with less text are still skeleton placeholders

  /* ------------------------------------------------------------------ */
  /*  Debug logging                                                      */
  /* ------------------------------------------------------------------ */

  function log() {
    var args = ['[SourceFence Search]'].concat(Array.prototype.slice.call(arguments));
    console.log.apply(console, args);
  }

  /* ------------------------------------------------------------------ */
  /*  Search page detection                                              */
  /* ------------------------------------------------------------------ */

  function isSearchPage() {
    var url = window.location.href;

    // Exclude profile pages (they're handled by linkedin-parser.js)
    if (url.indexOf('/talent/profile') !== -1) return false;

    return (
      url.indexOf('/talent/search') !== -1 ||
      (url.indexOf('/talent/hire') !== -1 && url.indexOf('/profile') === -1) ||
      url.indexOf('/sales/search') !== -1 ||
      url.indexOf('/search/results') !== -1
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Card selectors — LinkedIn Recruiter, Sales Nav, Standard           */
  /* ------------------------------------------------------------------ */

  var CARD_SELECTORS = [
    // LinkedIn Recruiter (newer redesign 2024+)
    '.hiring-search-results-card',
    '[data-test-search-result]',
    '[data-test-search-result-card]',
    '.hire-search-card',
    // LinkedIn Recruiter (classic list view)
    'ol.profile-list > li',
    '.profile-list > li',
    'li.profile-list__border-bottom',
    '[data-test-row]',
    '#results-list > li',
    '.result-lockup__entity',
    // Recruiter result containers
    '.search-results__result-container > li',
    '.search-results-container > li',
    '.search-results__result-item',
    // Sales Navigator
    '[data-view-name="search-entity-result-universal-template"]',
    // Standard LinkedIn search
    '.reusable-search__result-container li.reusable-search__result-container',
    '.entity-result',
    // Broader patterns
    '[class*="search-result"] li',
    'li[class*="result"]',
  ];

  /* ---- Profile link selectors (for content-based card detection) ---- */
  var PROFILE_LINK_PATTERNS = [
    'a[href*="/talent/profile/"]',
    'a[href*="/recruiter/profile/"]',
    'a[href*="/in/"]',
    'a[href*="/sales/lead/"]',
    'a[href*="/sales/people/"]',
  ];
  var PROFILE_LINK_SELECTOR = PROFILE_LINK_PATTERNS.join(', ');

  var LOCATION_SELECTORS_IN_CARD = [
    // Recruiter: location text under the name
    '.hiring-search-results-card__location',
    '[data-test-search-result-location]',
    // Standard LinkedIn
    '.entity-result__secondary-subtitle',
    '.artdeco-entity-lockup__subtitle',
    '.search-result__info .subline-level-2',
    '.t-black--light.t-12',
    // Sales Nav
    '[data-anonymize="location"]',
  ];

  var COMPANY_SELECTORS_IN_CARD = [
    // Recruiter: experience/company in the card
    '.hiring-search-results-card__experience',
    '[data-test-search-result-experience]',
    '.hiring-search-results-card__headline',
    // Standard LinkedIn
    '.entity-result__primary-subtitle',
    '.artdeco-entity-lockup__subtitle',
    '.search-result__info .subline-level-1',
    // Sales Nav
    '[data-anonymize="company-name"]',
  ];

  var NAME_SELECTORS_IN_CARD = [
    '.hiring-search-results-card__name',
    '.entity-result__title-text a',
    '.artdeco-entity-lockup__title a',
    '[data-test-search-result-name]',
    '[data-anonymize="person-name"]',
  ];

  /* ------------------------------------------------------------------ */
  /*  Badge styles and HTML                                              */
  /* ------------------------------------------------------------------ */

  var BADGE_STYLES_ID = 'sourcefence-search-styles';

  function ensureStyles() {
    if (document.getElementById(BADGE_STYLES_ID)) return;

    var style = document.createElement('style');
    style.id = BADGE_STYLES_ID;
    style.textContent = '\
      .sourcefence-search-badge {\
        display: inline-flex;\
        align-items: center;\
        gap: 4px;\
        padding: 2px 8px;\
        font-family: system-ui, -apple-system, sans-serif;\
        font-size: 11px;\
        font-weight: 700;\
        letter-spacing: 0.03em;\
        text-transform: uppercase;\
        border-radius: 4px;\
        margin-left: 8px;\
        vertical-align: middle;\
        line-height: 1;\
        cursor: default;\
        white-space: nowrap;\
      }\
      .sourcefence-search-badge--red {\
        background: #DC2626;\
        color: #ffffff;\
      }\
      .sourcefence-search-badge--amber {\
        background: #F59E0B;\
        color: #2D2D2D;\
      }\
      .sourcefence-search-badge svg {\
        width: 12px;\
        height: 12px;\
        flex-shrink: 0;\
      }\
      /* Left border accent on the whole card */\
      [data-sourcefence-severity="red"] {\
        border-left: 3px solid #DC2626 !important;\
      }\
      [data-sourcefence-severity="amber"] {\
        border-left: 3px solid #F59E0B !important;\
      }\
    ';
    document.head.appendChild(style);
  }

  var BADGE_ICONS = {
    red: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
    amber: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  };

  function createBadge(severity, message) {
    var badge = document.createElement('span');
    badge.className = BADGE_CLASS + ' sourcefence-search-badge--' + severity;
    badge.title = message || (severity === 'red' ? 'Restricted' : 'Caution');
    badge.setAttribute('role', 'status');

    var icon = BADGE_ICONS[severity] || '';
    var label = severity === 'red' ? 'RESTRICTED' : 'CAUTION';

    badge.innerHTML = icon + '<span>' + label + '</span>';
    return badge;
  }

  /* ------------------------------------------------------------------ */
  /*  Card detection                                                     */
  /* ------------------------------------------------------------------ */

  /**
   * Primary card finder: try known CSS selectors.
   */
  function findCardsViaSelectors() {
    for (var i = 0; i < CARD_SELECTORS.length; i++) {
      try {
        var cards = document.querySelectorAll(CARD_SELECTORS[i]);
        if (cards.length > 0) {
          return Array.prototype.slice.call(cards);
        }
      } catch (e) {
        // Skip invalid selectors
      }
    }
    return null;
  }

  /**
   * Broad class-name fallback.
   */
  function findCardsViaBroadClass() {
    try {
      var results = document.querySelectorAll(
        '[class*="search-results"] li, [class*="search-result"] li, [class*="profile-list"] li'
      );
      if (results.length > 0) {
        return Array.prototype.slice.call(results);
      }
    } catch (e) {
      // Skip
    }
    return null;
  }

  /**
   * Content-based fallback: find profile links, then walk up the DOM to
   * find the containing card element. This works regardless of CSS class
   * names and is resilient to LinkedIn Recruiter redesigns.
   */
  function findCardsViaProfileLinks() {
    var links = document.querySelectorAll(PROFILE_LINK_SELECTOR);
    if (links.length === 0) {
      log('No profile links found on page');
      return null;
    }

    // Walk up from profile links to find card containers

    var cards = [];
    var seen = [];

    for (var i = 0; i < links.length; i++) {
      // Skip links that are in nav, header, sidebar, etc.
      if (isInNonResultArea(links[i])) continue;

      var card = findCardContainer(links[i]);
      if (card && seen.indexOf(card) === -1) {
        seen.push(card);
        cards.push(card);
      }
    }

    return cards.length > 0 ? cards : null;
  }

  /**
   * Check if an element is inside a non-result area (nav, sidebar, etc.)
   */
  function isInNonResultArea(el) {
    var check = el;
    while (check && check !== document.body) {
      var tag = check.tagName;
      if (tag === 'NAV' || tag === 'HEADER' || tag === 'FOOTER') return true;
      var role = check.getAttribute('role');
      if (role === 'navigation' || role === 'banner' || role === 'complementary') return true;
      // Skip sidebar-like elements
      var cls = check.className || '';
      if (typeof cls === 'string' && (
        cls.indexOf('global-nav') !== -1 ||
        cls.indexOf('sidebar') !== -1 ||
        cls.indexOf('aside') !== -1 ||
        cls.indexOf('right-rail') !== -1
      )) return true;
      check = check.parentElement;
    }
    return false;
  }

  /**
   * Walk up from a profile link to find the card container element.
   * A card container is typically an <li>, <article>, or a <div>/<section>
   * that has siblings also containing profile links.
   */
  function findCardContainer(link) {
    var el = link.parentElement;
    var MAX_LEVELS = 15;
    var bestCandidate = null;

    for (var level = 0; el && el !== document.body && level < MAX_LEVELS; level++) {
      var tag = el.tagName;

      // <li> with siblings is the most common card container
      if (tag === 'LI') {
        var parent = el.parentElement;
        if (parent && parent.children.length > 1) {
          // Verify at least one sibling also has a profile link
          var hasSiblingWithProfile = false;
          var siblings = parent.children;
          for (var i = 0; i < Math.min(siblings.length, 5); i++) {
            if (siblings[i] !== el) {
              try {
                if (siblings[i].querySelector && siblings[i].querySelector(PROFILE_LINK_SELECTOR)) {
                  hasSiblingWithProfile = true;
                  break;
                }
              } catch (e) {}
            }
          }
          if (hasSiblingWithProfile) return el;
          // Even without verified siblings, an <li> is a strong candidate
          bestCandidate = el;
        }
      }

      // <article> is sometimes used for cards
      if (tag === 'ARTICLE') {
        return el;
      }

      // <div> or <section> — only if siblings also contain profile links
      if (tag === 'DIV' || tag === 'SECTION') {
        var divParent = el.parentElement;
        if (divParent && divParent.children.length > 1) {
          var divSiblings = divParent.children;
          var siblingHasProfile = false;
          for (var j = 0; j < Math.min(divSiblings.length, 5); j++) {
            if (divSiblings[j] !== el) {
              try {
                if (divSiblings[j].querySelector && divSiblings[j].querySelector(PROFILE_LINK_SELECTOR)) {
                  siblingHasProfile = true;
                  break;
                }
              } catch (e) {}
            }
          }
          if (siblingHasProfile) {
            bestCandidate = el;
            // For <div>, keep walking up in case there's a better container
          }
        }
      }

      el = el.parentElement;
    }

    return bestCandidate;
  }

  /**
   * Main card finder: tries all strategies in order of specificity.
   */
  function findCards() {
    return findCardsViaSelectors() ||
           findCardsViaBroadClass() ||
           findCardsViaProfileLinks() ||
           [];
  }

  /* ------------------------------------------------------------------ */
  /*  Card parsing                                                       */
  /* ------------------------------------------------------------------ */

  function extractTextFromCard(card, selectors) {
    for (var i = 0; i < selectors.length; i++) {
      try {
        var el = card.querySelector(selectors[i]);
        if (el) {
          var text = el.textContent.trim();
          if (text && text.length > 1 && text.length < 200) {
            return text;
          }
        }
      } catch (e) {
        // Skip invalid selectors
      }
    }
    return null;
  }

  /**
   * Clean a location string: strip industry suffix after "·" separator,
   * handle "Greater X Area" patterns.
   */
  function cleanLocation(text) {
    if (!text) return null;
    // Split on "·" or "•" — take the first part (location before industry)
    var parts = text.split(/\s*[·•]\s*/);
    var loc = parts[0].trim();
    if (loc.length < 2 || loc.length > 120) return null;
    return loc;
  }

  /**
   * Check if text indicates a former/ex company (person has left).
   * Matches: "ex Meta", "ex-Meta", "Ex LinkedIn", "former Google"
   */
  function isFormerCompanyText(text) {
    if (!text) return false;
    return /^(ex|former)[\s\-]/i.test(text.trim());
  }

  /**
   * Try to extract company from headline text.
   * Patterns: "Engineer at Acme", "Engineer | Acme", "Acme - Engineer"
   * Rejects "ex Company" / "former Company" — person has left.
   */
  function extractCompanyFromHeadline(headline) {
    if (!headline) return null;

    // "... at Company" — stop at pipe, comma, dash, or middot
    var atMatch = headline.match(/\bat\s+([^|,·•\-]+)/i);
    if (atMatch) {
      var co = atMatch[1].trim();
      // Remove trailing date patterns like "2024"
      co = co.replace(/\s*\d{4}\s*[-–]\s*(Present|\d{4})?\s*$/, '').trim();
      // Reject "ex Company" or "former Company" — person has left
      if (isFormerCompanyText(co)) return null;
      if (co.length > 1 && co.length < 80) return co;
    }

    // "Company | Role" — only for exactly 2 pipe-separated parts.
    // 3+ parts (e.g. "Total Rewards | Compensation | People Equity") is
    // typically a skill/keyword list, not a company-role pattern.
    var parts = headline.split(/\s*[|]\s*/);
    if (parts.length === 2) {
      var candidates = parts.filter(function (p) {
        return p.trim().length > 1 && p.trim().length < 60;
      });
      if (candidates.length === 2) {
        var result = candidates.reduce(function (a, b) {
          return a.length < b.length ? a : b;
        }).trim();
        // Reject "ex Company" or "former Company" — person has left
        if (isFormerCompanyText(result)) return null;
        return result;
      }
    }

    return null;
  }

  /**
   * Extract current companies from experience text entries in a Recruiter card.
   * Matches patterns like "Title at CompanyName · 2024 – Present"
   * Only returns companies where "Present" appears in the date portion,
   * indicating the candidate currently works there.
   * Returns an array of company names.
   */
  function extractCurrentCompaniesFromExperience(card) {
    var companies = [];
    var expTexts = [];

    // Collect experience-related text from the card
    try {
      // Look for text near "Experience" label
      var allElements = card.querySelectorAll('span, div, p, li, dd');
      var inExperienceSection = false;

      for (var i = 0; i < allElements.length; i++) {
        var el = allElements[i];
        var text = el.textContent.trim();

        // Detect "Experience" section header
        if (/^Experience$/i.test(text)) {
          inExperienceSection = true;
          continue;
        }
        // Stop at next section header
        if (inExperienceSection && /^(Education|Interest|Activity|Skills|Certifications)$/i.test(text)) {
          break;
        }

        // Collect "Title at Company" patterns only for CURRENT positions
        // (with "Present" or "Current" in dates — Recruiter may use either)
        if (text.length > 5 && text.length < 200 && /\bat\s+/i.test(text) && /\b(Present|Current)\b/i.test(text)) {
          expTexts.push(text);
        }
      }
    } catch (e) {
      // Skip
    }

    // Parse "at Company" from collected texts
    for (var j = 0; j < expTexts.length; j++) {
      var match = expTexts[j].match(/\bat\s+([^·•\n]+?)(?:\s*[·•]|\s*\d{4}|\s*$)/i);
      if (match) {
        var company = match[1].trim()
          .replace(/\s*[-–]\s*$/, '') // trailing dash
          .replace(/\s+/g, ' ');      // collapse whitespace
        if (company.length > 1 && company.length < 80 && !/^\d+$/.test(company)) {
          companies.push(company);
        }
      }
    }

    return companies;
  }

  /**
   * Validate whether a text string actually looks like a location.
   * Rejects headlines (contain |), @ mentions, and overly long strings.
   */
  function isValidLocationText(text) {
    if (!text || text.length < 3 || text.length > 120) return false;
    // Reject if it contains | or @ (likely a headline, not a location)
    if (text.indexOf('|') !== -1 || text.indexOf('@') !== -1) return false;
    // Clean the text (remove industry part after ·)
    var clean = cleanLocation(text) || text;
    if (!clean || clean.length < 3) return false;
    // Must have a comma (location separator like "City, Country")
    if (clean.indexOf(',') === -1) return false;
    // Contains comma + known geographic words
    var geoPatterns = /,\s*(area|region|county|state|province|kingdom|republic)/i;
    var countryPattern = /(united|greater|metropolitan|area$)/i;
    if (geoPatterns.test(clean) || countryPattern.test(clean)) return true;
    // Contains a comma and reasonable word count
    if (clean.split(/\s+/).length <= 8) return true;
    return false;
  }

  /**
   * Extract companies from "Current:" and "Past:" annotation lines.
   * LinkedIn normal search shows lines like:
   *   "Current: Senior Technical Recruiter at Meta"
   *   "Past: Functional Recruiting Leader - Tech at Meta"
   * Returns { current: [...], past: [...] } company name arrays.
   */
  function extractCurrentPastFromCard(card) {
    var current = [];
    var past = [];

    try {
      var elements = card.querySelectorAll('span, div, p');
      for (var i = 0; i < elements.length; i++) {
        var text = elements[i].textContent.trim();

        var currentMatch = text.match(/^Current:\s*(.+)/i);
        if (currentMatch) {
          var co = extractCompanyFromHeadline(currentMatch[1]);
          if (co && current.indexOf(co) === -1) current.push(co);
          continue;
        }

        var pastMatch = text.match(/^Past:\s*(.+)/i);
        if (pastMatch) {
          var pastCo = extractCompanyFromHeadline(pastMatch[1]);
          if (pastCo && past.indexOf(pastCo) === -1) past.push(pastCo);
        }
      }
    } catch (e) {
      // Skip
    }

    return { current: current, past: past };
  }

  /**
   * Check if a company name matches any in a list of past companies.
   * Case-insensitive exact match.
   */
  function isPastCompany(company, pastCompanies) {
    if (!company || pastCompanies.length === 0) return false;
    var normalized = company.toLowerCase().trim();
    for (var i = 0; i < pastCompanies.length; i++) {
      if (pastCompanies[i].toLowerCase().trim() === normalized) {
        return true;
      }
    }
    return false;
  }

  function parseCard(card) {
    // --- Current / Past detection (LinkedIn normal search) ---
    // Parse "Current:" and "Past:" annotation lines early so we can
    // use them to guide company extraction and filter past employers.
    var currentPast = extractCurrentPastFromCard(card);

    // --- Location ---
    // Try CSS selectors first, but validate the result isn't a headline
    var rawLocation = extractTextFromCard(card, LOCATION_SELECTORS_IN_CARD);
    var location = null;

    if (rawLocation && isValidLocationText(rawLocation)) {
      location = cleanLocation(rawLocation);
    }

    // Fallback: walk all text nodes looking for valid location patterns
    if (!location) {
      try {
        var allText = card.querySelectorAll('span, div, p');
        for (var j = 0; j < allText.length; j++) {
          var t = allText[j].textContent.trim();
          if (t && isValidLocationText(t)) {
            location = cleanLocation(t);
            break;
          }
        }
      } catch (e) {
        // Skip
      }
    }

    // --- Company ---
    var company = null;

    // Strategy 0: If "Current:" lines found, use those as highest-priority source
    if (currentPast.current.length > 0) {
      company = currentPast.current[0];
    }

    // Strategy 1: Extract from card headline
    if (!company) {
      var headlineEl = null;
      var headlineSelectors = [
        '.artdeco-entity-lockup__subtitle',
        '.hiring-search-results-card__headline',
        '.entity-result__primary-subtitle',
        '.search-result__info .subline-level-1',
      ];
      for (var h = 0; h < headlineSelectors.length; h++) {
        try {
          headlineEl = card.querySelector(headlineSelectors[h]);
          if (headlineEl) break;
        } catch (e) {}
      }

      if (headlineEl) {
        var headlineText = headlineEl.textContent.trim();
        if (headlineText) {
          company = extractCompanyFromHeadline(headlineText);
        }
      }
    }

    // Strategy 1b: If no headline selector worked, try content-based approach.
    // Find the first profile link, then check sibling/nearby text for "at Company".
    if (!company) {
      try {
        var profileLink = card.querySelector(PROFILE_LINK_SELECTOR);
        if (profileLink) {
          // Walk siblings of the link's parent looking for headline-like text.
          // Guard: linkParent must NOT be the card itself — otherwise siblings
          // are adjacent cards in the list, not elements within this card.
          var linkParent = profileLink.parentElement;
          if (linkParent && linkParent !== card) {
            var siblingEl = linkParent.nextElementSibling;
            for (var s = 0; s < 3 && siblingEl; s++) {
              // Stop if we've walked outside the card
              if (!card.contains(siblingEl)) break;
              var sibText = siblingEl.textContent.trim();
              // Skip "Past:" lines — person no longer works there
              if (/^Past:\s/i.test(sibText)) {
                siblingEl = siblingEl.nextElementSibling;
                continue;
              }
              if (sibText && sibText.length > 5 && sibText.length < 200) {
                var sibCompany = extractCompanyFromHeadline(sibText);
                if (sibCompany) {
                  company = sibCompany;
                  break;
                }
              }
              siblingEl = siblingEl.nextElementSibling;
            }
          }
        }
      } catch (e) {
        // Skip
      }
    }

    // Strategy 2: Extract current companies from experience section
    var experienceCompanies = extractCurrentCompaniesFromExperience(card);

    // Merge "Current:" companies into experience companies list
    for (var c = 0; c < currentPast.current.length; c++) {
      if (experienceCompanies.indexOf(currentPast.current[c]) === -1) {
        experienceCompanies.push(currentPast.current[c]);
      }
    }

    if (!company && experienceCompanies.length > 0) {
      company = experienceCompanies[0];
    }

    // Strategy 3: Try CSS selectors for company
    if (!company) {
      var rawCompany = extractTextFromCard(card, COMPANY_SELECTORS_IN_CARD);
      // Reject CSS result if it looks like a headline (contains |)
      if (rawCompany && rawCompany.indexOf('|') === -1 && rawCompany.length < 80) {
        company = rawCompany;
      }
    }

    // Strategy 4: Last resort — try "at Company" extraction from any text
    if (!company) {
      try {
        var textElements = card.querySelectorAll('span, div, p');
        for (var k = 0; k < textElements.length; k++) {
          var txt = textElements[k].textContent.trim();
          if (txt.length < 10 || txt.length > 200) continue;
          // Skip "Past:" lines — person no longer works there
          if (/^Past:\s/i.test(txt)) continue;
          if (/^(Experience|Education|Interest|Activity|Skills)$/i.test(txt)) continue;
          if (/^\d{4}\s*[-–]/.test(txt)) continue;
          var co = extractCompanyFromHeadline(txt);
          if (co) {
            company = co;
            break;
          }
        }
      } catch (e) {
        // Skip
      }
    }

    log('Parsed card -', 'location:', location || '(none)', '| company:', company || '(none)',
        '| exp companies:', experienceCompanies.join(', ') || '(none)',
        '| past companies:', currentPast.past.join(', ') || '(none)');

    return {
      location: location,
      company: company,
      allCompanies: experienceCompanies,
      pastCompanies: currentPast.past,
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Annotation engine                                                  */
  /* ------------------------------------------------------------------ */

  function annotateCards() {
    if (!isSearchPage()) return;

    ensureStyles();

    var cards = findCards();
    if (cards.length === 0) {
      // Retry a few times in case the page hasn't loaded results yet
      if (retryCount < MAX_RETRIES) {
        retryCount++;
        log('No cards found, retry', retryCount, 'of', MAX_RETRIES, 'in', RETRY_INTERVAL_MS + 'ms');
        setTimeout(annotateCards, RETRY_INTERVAL_MS);
      } else {
        log('No cards found after', MAX_RETRIES, 'retries. Page may use unsupported DOM structure.');
      }
      return;
    }

    // Reset retry count on success
    retryCount = 0;

    // Set up IntersectionObserver on first successful card detection
    setupIntersectionObserver(cards);

    // Filter to cards that need processing:
    //   - Not already 'done' (fully processed with data)
    //   - Has enough text content to be a rendered card (not a skeleton placeholder)
    var pending = [];
    for (var f = 0; f < cards.length; f++) {
      if (cards[f].getAttribute(ANNOTATED_ATTR) === 'done') continue;
      // Skip skeleton placeholders (empty or near-empty <li> elements).
      // LinkedIn lazy-renders card content only when scrolled into viewport.
      if (cards[f].textContent.trim().length < MIN_CARD_TEXT_LENGTH) continue;
      pending.push(cards[f]);
    }

    // Nothing to do
    if (pending.length === 0) return;

    // Check if matcher is available — use matchOnly() to avoid banner side effects
    var matcher = window.SourceFenceMatcher;
    var matchFn = matcher && (
      typeof matcher.matchOnly === 'function'
        ? matcher.matchOnly
        : (typeof matcher.checkCandidate === 'function' ? matcher.checkCandidate : null)
    );

    if (!matchFn) {
      log('Matcher not ready, retrying in 500ms');
      setTimeout(annotateCards, 500);
      return;
    }

    log('Annotating', pending.length, 'of', cards.length, 'cards (rest done or skeleton)');

    for (var i = 0; i < pending.length; i++) {
      annotateSingleCard(pending[i], matchFn);
    }
  }

  function annotateSingleCard(card, matchFn) {
    // If fully processed, skip
    if (card.getAttribute(ANNOTATED_ATTR) === 'done') return;

    var data = parseCard(card);

    // Need at least one data point — if card has no extractable data,
    // just return without marking anything. The card will be re-checked
    // when LinkedIn renders more content into it (caught by
    // MutationObserver, IntersectionObserver, or scroll handler).
    if (!data.location && !data.company && data.allCompanies.length === 0) {
      return;
    }

    // Data found — mark as fully processed
    card.setAttribute(ANNOTATED_ATTR, 'done');

    // Filter out past companies before matching.
    // If a company appears in "Past:" lines (and NOT in "Current:"),
    // the person has left — don't flag them for that company.
    var pastCompanies = data.pastCompanies || [];
    var companyToCheck = data.company;

    if (companyToCheck && isPastCompany(companyToCheck, pastCompanies)) {
      companyToCheck = null;
    }

    var currentCompanies = [];
    for (var i = 0; i < data.allCompanies.length; i++) {
      if (!isPastCompany(data.allCompanies[i], pastCompanies)) {
        currentCompanies.push(data.allCompanies[i]);
      }
    }

    // Check the primary location + company
    try {
      matchFn({
        location: data.location,
        company: companyToCheck,
      }).then(function (result) {
        // If primary check is green but we have additional companies from experience,
        // check ALL of them (some may be duplicates of the primary, which is fine)
        if ((!result || result.severity === 'green') && currentCompanies.length > 0) {
          return checkAdditionalCompanies(currentCompanies, data.location, matchFn, result);
        }
        return result;
      }).then(function (result) {
        if (!result || result.severity === 'green') return;
        injectBadge(card, result);
      });
    } catch (err) {
      console.warn('[SourceFence] Error annotating card:', err);
    }
  }

  /**
   * Check additional companies from experience entries.
   * Returns the highest-severity result across all companies.
   */
  function checkAdditionalCompanies(companies, location, matchFn, bestSoFar) {
    var promises = companies.map(function (co) {
      return matchFn({ location: location, company: co });
    });

    return Promise.all(promises).then(function (results) {
      var highest = bestSoFar || { severity: 'green', message: '' };
      var RANK = { green: 0, amber: 1, red: 2 };

      for (var i = 0; i < results.length; i++) {
        if (results[i] && (RANK[results[i].severity] || 0) > (RANK[highest.severity] || 0)) {
          highest = results[i];
        }
      }
      return highest;
    });
  }

  /**
   * Find the best element to place a badge next to within a card.
   * Prefers specific name selectors, then falls back to the FIRST
   * profile link whose text is short enough to be just a name (not
   * the card-wrapping link that contains all text).  DOM order
   * guarantees the name link appears before any connection links.
   */
  function findBadgeAnchor(card) {
    // Try specific name selectors first (Recruiter, Sales Nav)
    for (var i = 0; i < NAME_SELECTORS_IN_CARD.length; i++) {
      try {
        var el = card.querySelector(NAME_SELECTORS_IN_CARD[i]);
        if (el) return { el: el, mode: 'after' };
      } catch (e) {}
    }

    // Fallback (standard LinkedIn search): find the first profile link
    // whose visible text is short (just the person's name).  We pick the
    // FIRST match in DOM order — not the shortest — because the name link
    // always precedes any mutual-connection links in the card markup.
    try {
      var links = card.querySelectorAll(PROFILE_LINK_SELECTOR);
      for (var j = 0; j < links.length; j++) {
        var textLen = links[j].textContent.trim().length;
        // Skip the outer card-wrapping link (contains all card text, very long)
        // and skip empty/tiny links (icon-only buttons)
        if (textLen > 2 && textLen < 60) {
          var parent = links[j].parentNode;
          // If the link sits inside a <p>, <span>, <h3>, or <h4>, append
          // the badge inside that container so it flows inline with the name
          if (parent && (parent.tagName === 'P' || parent.tagName === 'SPAN' ||
              parent.tagName === 'H3' || parent.tagName === 'H4')) {
            return { el: parent, mode: 'append' };
          }
          return { el: links[j], mode: 'after' };
        }
      }
    } catch (e) {}

    return null;
  }

  /**
   * Inject a badge next to the candidate's name in the card.
   */
  function injectBadge(card, result) {
    var anchor = findBadgeAnchor(card);

    if (anchor) {
      var badge = createBadge(result.severity, result.message);
      if (anchor.mode === 'append') {
        // Append inside the container (inline with name text)
        anchor.el.appendChild(badge);
      } else {
        // Insert after the element
        if (anchor.el.parentNode) {
          anchor.el.parentNode.insertBefore(badge, anchor.el.nextSibling);
        }
      }
    }

    // Add colored left border to the card
    card.setAttribute('data-sourcefence-severity', result.severity);

    log('Badge injected:', result.severity, '|', result.message);
  }

  /* ------------------------------------------------------------------ */
  /*  IntersectionObserver — process cards when they enter the viewport  */
  /* ------------------------------------------------------------------ */

  var intersectionObserver = null;
  var observedCards = []; // track which cards we're already observing

  /**
   * Set up an IntersectionObserver to watch card elements.  When a card
   * scrolls into view and has content (i.e. LinkedIn has rendered it),
   * trigger annotation.  This is the primary mechanism for catching
   * lazily-rendered cards that were empty skeleton <li> elements on
   * initial page load.
   */
  function setupIntersectionObserver(cards) {
    if (!('IntersectionObserver' in window)) return;

    if (!intersectionObserver) {
      intersectionObserver = new IntersectionObserver(function (entries) {
        var needsAnnotation = false;
        for (var i = 0; i < entries.length; i++) {
          var entry = entries[i];
          if (!entry.isIntersecting) continue;
          var card = entry.target;
          // Only process if: not yet done, AND has real content
          if (card.getAttribute(ANNOTATED_ATTR) !== 'done' &&
              card.textContent.trim().length >= MIN_CARD_TEXT_LENGTH) {
            needsAnnotation = true;
          }
        }
        if (needsAnnotation) {
          throttledAnnotate();
        }
      }, {
        // Trigger a little before the card is fully visible (200px margin)
        rootMargin: '200px 0px',
        threshold: 0
      });
    }

    // Observe any new cards we haven't seen yet
    for (var j = 0; j < cards.length; j++) {
      if (observedCards.indexOf(cards[j]) === -1) {
        intersectionObserver.observe(cards[j]);
        observedCards.push(cards[j]);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Throttled annotation (replaces pure debounce)                      */
  /*                                                                     */
  /*  Pure debounce kept resetting the 500 ms timer on every scroll /    */
  /*  mutation event, so annotateCards() wouldn't fire until scrolling    */
  /*  stopped — by which time the user had already seen un-badged cards. */
  /*  Throttle guarantees annotateCards() runs at most every DEBOUNCE_MS */
  /*  even during continuous scrolling, AND once more after events stop. */
  /* ------------------------------------------------------------------ */

  var observer = null;
  var throttleTimer = null;
  var trailingTimer = null;
  var lastThrottleRun = 0;

  function throttledAnnotate() {
    var now = Date.now();
    var elapsed = now - lastThrottleRun;

    // Clear any pending trailing call
    if (trailingTimer) clearTimeout(trailingTimer);

    if (elapsed >= DEBOUNCE_MS) {
      // Enough time has passed — fire immediately
      lastThrottleRun = now;
      annotateCards();
    }

    // Always schedule a trailing call to catch the last batch
    trailingTimer = setTimeout(function () {
      lastThrottleRun = Date.now();
      annotateCards();
    }, DEBOUNCE_MS);
  }

  function startObserver() {
    if (observer) observer.disconnect();

    observer = new MutationObserver(function () {
      throttledAnnotate();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  /* ------------------------------------------------------------------ */
  /*  URL change detection (Recruiter SPA navigation)                    */
  /* ------------------------------------------------------------------ */

  var lastUrl = window.location.href;

  function checkUrlChange() {
    var currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      log('URL changed to:', currentUrl);

      // Clean up annotations from previous page
      cleanupAnnotations();

      // Reset retry counter
      retryCount = 0;

      // Re-annotate if this is a search page
      if (isSearchPage()) {
        setTimeout(function () {
          annotateCards();
          startPeriodicRescan();
        }, 1000); // wait for DOM to settle
      } else {
        // Not a search page — stop periodic re-scan
        if (rescanInterval) {
          clearInterval(rescanInterval);
          rescanInterval = null;
        }
      }
    }
  }

  function cleanupAnnotations() {
    // Remove all badges
    var badges = document.querySelectorAll('.' + BADGE_CLASS);
    for (var i = 0; i < badges.length; i++) {
      badges[i].remove();
    }
    // Clear annotation attributes
    var annotated = document.querySelectorAll('[' + ANNOTATED_ATTR + ']');
    for (var j = 0; j < annotated.length; j++) {
      annotated[j].removeAttribute(ANNOTATED_ATTR);
      annotated[j].removeAttribute('data-sourcefence-severity');
    }
    // Reset IntersectionObserver tracking so new cards get observed
    observedCards = [];
    // Reset throttle state so next event fires immediately
    lastThrottleRun = 0;
  }

  /* ------------------------------------------------------------------ */
  /*  Periodic re-scan safety net                                        */
  /*                                                                     */
  /*  LinkedIn Recruiter virtualizes its card list — card content is     */
  /*  only rendered when near the viewport.  If the user scrolls fast,   */
  /*  LinkedIn may render card content AFTER the card has already passed  */
  /*  through the viewport.  The MutationObserver usually catches this,  */
  /*  but throttle timing can still miss cards.  This interval acts as   */
  /*  a safety net: every 2 s, check for rendered-but-unannotated cards. */
  /* ------------------------------------------------------------------ */

  var rescanInterval = null;

  function startPeriodicRescan() {
    if (rescanInterval) clearInterval(rescanInterval);

    rescanInterval = setInterval(function () {
      if (!isSearchPage()) {
        clearInterval(rescanInterval);
        rescanInterval = null;
        return;
      }
      // Let annotateCards() determine if there's work to do.
      // It returns early when pending.length === 0, so the cost
      // is just one querySelectorAll per tick — acceptable.
      annotateCards();
    }, 2000);
  }

  /* ------------------------------------------------------------------ */
  /*  Initialize                                                         */
  /* ------------------------------------------------------------------ */

  function init() {
    log('Initializing. URL:', window.location.href, '| isSearchPage:', isSearchPage());

    // Only run on search pages
    if (!isSearchPage()) return;

    // Hide the top banner on search pages — per-card badges are better
    if (typeof window.SourceFenceBanner !== 'undefined' &&
        typeof window.SourceFenceBanner.destroy === 'function') {
      window.SourceFenceBanner.destroy();
    }

    // Wait for the page to load results, then annotate
    setTimeout(function () {
      annotateCards();
      startObserver();
      startPeriodicRescan();
    }, INITIAL_DELAY_MS);

    // Scroll listener — LinkedIn renders cards lazily as user scrolls
    window.addEventListener('scroll', throttledAnnotate, { passive: true });

    // URL polling for SPA navigation
    setInterval(checkUrlChange, 1000);

    // Listen for popstate
    window.addEventListener('popstate', function () {
      setTimeout(function () {
        checkUrlChange();
      }, 500);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Re-annotate on rules change                                        */
  /* ------------------------------------------------------------------ */

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (!message || !message.type) return;

      if (message.type === 'RULES_UPDATED') {
        cleanupAnnotations();
        retryCount = 0;
        setTimeout(annotateCards, 300);
      }

      if (message.type === 'GET_SEARCH_STATUS') {
        // Popup requesting search page badge counts
        var badges = document.querySelectorAll('.' + BADGE_CLASS);
        var redCount = 0;
        var amberCount = 0;
        for (var i = 0; i < badges.length; i++) {
          if (badges[i].className.indexOf('--red') !== -1) redCount++;
          else if (badges[i].className.indexOf('--amber') !== -1) amberCount++;
        }
        var totalCards = document.querySelectorAll('[' + ANNOTATED_ATTR + ']').length;
        sendResponse({
          type: 'SEARCH_STATUS',
          data: {
            isSearchPage: true,
            totalCards: totalCards,
            redCount: redCount,
            amberCount: amberCount,
            flaggedCount: redCount + amberCount
          }
        });
        return true;
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Bootstrap                                                          */
  /* ------------------------------------------------------------------ */

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for testing and debugging
  window.SourceFenceSearchAnnotator = {
    init: init,
    annotateCards: annotateCards,
    cleanupAnnotations: cleanupAnnotations,
    isSearchPage: isSearchPage,
    findCards: findCards,
    parseCard: function (card) { return parseCard(card); },
  };
})();
