/**
 * SourceFence Banner Module
 *
 * Injects alert banners into LinkedIn pages using Shadow DOM encapsulation.
 * Banners are injected INLINE above the profile card — not as a fixed overlay.
 *
 * Behavior by severity:
 *   Red/Amber — persistent. Dismiss minimizes to a small pill badge. Click pill to expand.
 *   Green    — auto-dismiss after a few seconds. No pill residual.
 *
 * Exposed as window.SourceFenceBanner with methods:
 *   show({ severity, message })  - inject and display a banner
 *   dismiss()                    - minimize (red/amber) or remove (green)
 *   destroy()                    - immediately remove everything
 */
(function () {
  'use strict';

  var BANNER_HOST_ID = 'sourcefence-banner-host';
  var ANIMATION_DURATION_MS = 300;

  var DEFAULT_SETTINGS = {
    enabled: true,
    show_green_alerts: true,
    green_auto_dismiss_seconds: 3,
    alert_position: 'top',
  };

  /* ------------------------------------------------------------------ */
  /*  Positioning: fixed below LinkedIn's nav bar via content.css       */
  /*  No DOM anchor needed — host is appended to body, CSS handles it  */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /*  SVG Icons                                                         */
  /* ------------------------------------------------------------------ */

  var ICONS = {
    red: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',

    amber: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',

    green: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',

    dismiss: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',

    expand: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>',
  };

  /* ------------------------------------------------------------------ */
  /*  Shadow DOM Styles                                                 */
  /* ------------------------------------------------------------------ */

  function buildShadowStyles() {
    return '\
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\
      \
      :host { display: block; width: 100%; }\
      \
      .sf-banner {\
        display: flex;\
        align-items: center;\
        gap: 10px;\
        width: 100%;\
        padding: 10px 16px;\
        font-family: system-ui, -apple-system, sans-serif;\
        font-size: 14px;\
        line-height: 1.4;\
        border-radius: 8px;\
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);\
        pointer-events: auto;\
        opacity: 0;\
        transform: translateY(-12px);\
        transition: opacity ' + ANIMATION_DURATION_MS + 'ms ease-out, transform ' + ANIMATION_DURATION_MS + 'ms ease-out;\
      }\
      \
      .sf-banner.sf-visible {\
        opacity: 1;\
        transform: translateY(0);\
      }\
      \
      /* ---- Severity: Red ---- */\
      .sf-banner--red {\
        background: #DC2626;\
        color: #ffffff;\
        box-shadow: 0 2px 8px rgba(220, 38, 38, 0.3);\
      }\
      .sf-banner--red .sf-dismiss-btn { color: #ffffff; }\
      .sf-banner--red .sf-dismiss-btn:hover { background: rgba(255, 255, 255, 0.2); }\
      .sf-banner--red .sf-branding { color: rgba(255, 255, 255, 0.8); }\
      .sf-banner--red .sf-separator { background: rgba(255, 255, 255, 0.3); }\
      \
      /* ---- Severity: Amber ---- */\
      .sf-banner--amber {\
        background: #F59E0B;\
        color: #2D2D2D;\
        box-shadow: 0 2px 8px rgba(245, 158, 11, 0.3);\
      }\
      .sf-banner--amber .sf-dismiss-btn { color: #2D2D2D; }\
      .sf-banner--amber .sf-dismiss-btn:hover { background: rgba(0, 0, 0, 0.1); }\
      .sf-banner--amber .sf-branding { color: rgba(45, 45, 45, 0.7); }\
      .sf-banner--amber .sf-separator { background: rgba(45, 45, 45, 0.2); }\
      \
      /* ---- Severity: Green ---- */\
      .sf-banner--green {\
        background: #ffffff;\
        color: #2D2D2D;\
        border: 1px solid #e5e7eb;\
        border-left: 4px solid #0EA5A0;\
        font-size: 13px;\
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);\
      }\
      .sf-banner--green .sf-dismiss-btn { color: #6B7280; }\
      .sf-banner--green .sf-dismiss-btn:hover { background: rgba(0, 0, 0, 0.06); }\
      .sf-banner--green .sf-icon { color: #0EA5A0; }\
      .sf-banner--green .sf-branding { color: #9CA3AF; }\
      .sf-banner--green .sf-separator { background: #d1d5db; }\
      \
      /* ---- Pill badge (minimized state for red/amber) ---- */\
      .sf-pill {\
        display: inline-flex;\
        align-items: center;\
        gap: 6px;\
        padding: 5px 12px;\
        font-family: system-ui, -apple-system, sans-serif;\
        font-size: 12px;\
        font-weight: 700;\
        letter-spacing: 0.04em;\
        text-transform: uppercase;\
        border-radius: 6px;\
        cursor: pointer;\
        user-select: none;\
        pointer-events: auto;\
        opacity: 0;\
        transform: translateY(-4px);\
        transition: opacity ' + ANIMATION_DURATION_MS + 'ms ease-out, transform ' + ANIMATION_DURATION_MS + 'ms ease-out, box-shadow 150ms ease;\
      }\
      .sf-pill.sf-visible {\
        opacity: 1;\
        transform: translateY(0);\
      }\
      .sf-pill:hover {\
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);\
      }\
      .sf-pill--red {\
        background: #DC2626;\
        color: #ffffff;\
      }\
      .sf-pill--amber {\
        background: #F59E0B;\
        color: #2D2D2D;\
      }\
      .sf-pill-icon {\
        display: flex;\
        align-items: center;\
      }\
      .sf-pill-expand {\
        display: flex;\
        align-items: center;\
        opacity: 0.6;\
      }\
      \
      /* ---- Layout pieces ---- */\
      .sf-branding {\
        font-size: 11px;\
        font-weight: 600;\
        letter-spacing: 0.02em;\
        white-space: nowrap;\
        user-select: none;\
        flex-shrink: 0;\
      }\
      .sf-separator {\
        width: 1px;\
        height: 16px;\
        flex-shrink: 0;\
      }\
      .sf-icon {\
        display: flex;\
        align-items: center;\
        flex-shrink: 0;\
      }\
      .sf-message {\
        flex: 1;\
        min-width: 0;\
        font-weight: 500;\
      }\
      .sf-label {\
        font-weight: 700;\
        text-transform: uppercase;\
        letter-spacing: 0.04em;\
        margin-right: 6px;\
      }\
      .sf-dismiss-btn {\
        display: flex;\
        align-items: center;\
        justify-content: center;\
        width: 26px;\
        height: 26px;\
        border: none;\
        background: transparent;\
        border-radius: 4px;\
        cursor: pointer;\
        flex-shrink: 0;\
        transition: background 150ms ease;\
        padding: 0;\
      }\
      .sf-dismiss-btn:focus-visible {\
        outline: 2px solid currentColor;\
        outline-offset: 2px;\
      }\
    ';
  }

  /* ------------------------------------------------------------------ */
  /*  Banner HTML builders                                              */
  /* ------------------------------------------------------------------ */

  var SEVERITY_CONFIG = {
    red: { cssClass: 'sf-banner--red', pillClass: 'sf-pill--red', label: 'RESTRICTED', icon: ICONS.red },
    amber: { cssClass: 'sf-banner--amber', pillClass: 'sf-pill--amber', label: 'CAUTION', icon: ICONS.amber },
    green: { cssClass: 'sf-banner--green', pillClass: '', label: '', icon: ICONS.green },
  };

  function buildBannerHTML(severity, message) {
    var config = SEVERITY_CONFIG[severity];
    if (!config) {
      console.warn('[SourceFence] Unknown severity:', severity);
      return '';
    }

    var labelSpan = config.label
      ? '<span class="sf-label">' + config.label + ' &mdash;</span>'
      : '';

    var messageText = message || (severity === 'green' ? 'No restrictions apply' : '');

    return '<div class="sf-banner ' + config.cssClass + '" role="alert" aria-live="assertive">' +
      '<span class="sf-branding">SourceFence</span>' +
      '<span class="sf-separator"></span>' +
      '<span class="sf-icon">' + config.icon + '</span>' +
      '<span class="sf-message">' + labelSpan + escapeHTML(messageText) + '</span>' +
      '<button class="sf-dismiss-btn" aria-label="Dismiss banner" title="Dismiss">' + ICONS.dismiss + '</button>' +
      '</div>';
  }

  function buildPillHTML(severity) {
    var config = SEVERITY_CONFIG[severity];
    if (!config) return '';

    return '<div class="sf-pill ' + config.pillClass + '" role="button" tabindex="0" aria-label="' + config.label + ' — click to expand" title="Click to expand alert">' +
      '<span class="sf-pill-icon">' + config.icon + '</span>' +
      '<span>' + config.label + '</span>' +
      '<span class="sf-pill-expand">' + ICONS.expand + '</span>' +
      '</div>';
  }

  /* ------------------------------------------------------------------ */
  /*  Utility                                                           */
  /* ------------------------------------------------------------------ */

  function escapeHTML(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  /**
   * Detect LinkedIn's nav bar height for precise positioning.
   * Falls back to 52px if detection fails.
   */
  function getNavBarHeight() {
    try {
      var nav = document.querySelector('.global-nav__content') ||
                document.querySelector('header.global-nav') ||
                document.querySelector('#global-nav') ||
                document.querySelector('nav[role="navigation"]');
      if (nav) {
        var rect = nav.getBoundingClientRect();
        return Math.round(rect.bottom);
      }
    } catch (e) {
      // Detection failed
    }
    return 52; // LinkedIn's standard nav height
  }

  /* ------------------------------------------------------------------ */
  /*  Settings                                                          */
  /* ------------------------------------------------------------------ */

  function loadSettings() {
    return new Promise(function (resolve) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get('sourcefence_settings', function (result) {
          resolve(Object.assign({}, DEFAULT_SETTINGS, result.sourcefence_settings || {}));
        });
      } else {
        resolve(Object.assign({}, DEFAULT_SETTINGS));
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /*  State                                                             */
  /* ------------------------------------------------------------------ */

  /** @type {HTMLElement|null} */
  var currentHost = null;

  /** @type {ShadowRoot|null} */
  var currentShadow = null;

  /** @type {number|null} */
  var autoDismissTimer = null;

  /** @type {string|null} - current severity for pill minimization */
  var currentSeverity = null;

  /** @type {string|null} - current message for re-expansion */
  var currentMessage = null;

  /** @type {boolean} - whether we're in pill (minimized) state */
  var isMinimized = false;

  function clearAutoDismissTimer() {
    if (autoDismissTimer !== null) {
      clearTimeout(autoDismissTimer);
      autoDismissTimer = null;
    }
  }

  function removeExistingHost() {
    clearAutoDismissTimer();
    var existing = document.getElementById(BANNER_HOST_ID);
    if (existing) {
      existing.remove();
    }
    currentHost = null;
    currentShadow = null;
    isMinimized = false;
  }

  /* ------------------------------------------------------------------ */
  /*  Inject helper                                                     */
  /* ------------------------------------------------------------------ */

  function injectHost(host) {
    // Check if a recruiter side panel is open — inject inside it
    var sidePanel = document.querySelector('.profile-slidein__container');
    if (sidePanel) {
      // Override fixed positioning for in-panel injection
      host.style.position = 'relative';
      host.style.top = '0';
      host.style.left = '0';
      host.style.transform = 'none';
      host.style.maxWidth = '100%';
      host.style.zIndex = '10';
      host.style.padding = '8px 16px 0';
      sidePanel.insertBefore(host, sidePanel.firstChild);
      return;
    }

    // Default: fixed positioning below LinkedIn's nav bar
    var navHeight = getNavBarHeight();
    host.style.top = navHeight + 'px';
    document.body.appendChild(host);
  }

  /* ------------------------------------------------------------------ */
  /*  Show / Dismiss / Expand / Destroy                                 */
  /* ------------------------------------------------------------------ */

  /**
   * Show a SourceFence banner inline above the profile card.
   *
   * @param {Object} options
   * @param {'red'|'amber'|'green'} options.severity
   * @param {string} [options.message]
   */
  function show(options) {
    if (!options) return;
    var severity = options.severity;
    var message = options.message;

    loadSettings().then(function (settings) {
      // Global kill switch
      if (!settings.enabled) return;

      // Green suppression
      if (severity === 'green' && !settings.show_green_alerts) return;

      // Clean up any previous banner
      removeExistingHost();

      // Store for pill re-expansion
      currentSeverity = severity;
      currentMessage = message;

      // Build host + shadow DOM
      var host = document.createElement('div');
      host.id = BANNER_HOST_ID;

      var shadow = host.attachShadow({ mode: 'closed' });

      var styleEl = document.createElement('style');
      styleEl.textContent = buildShadowStyles();
      shadow.appendChild(styleEl);

      var wrapper = document.createElement('div');
      wrapper.innerHTML = buildBannerHTML(severity, message);
      shadow.appendChild(wrapper.firstElementChild);

      // Inject inline above profile card
      injectHost(host);

      currentHost = host;
      currentShadow = shadow;

      // Trigger fade-in animation on next frame
      var bannerEl = shadow.querySelector('.sf-banner');
      if (bannerEl) {
        bannerEl.getBoundingClientRect(); // force layout flush
        bannerEl.classList.add('sf-visible');
      }

      // Wire up dismiss button
      var dismissBtn = shadow.querySelector('.sf-dismiss-btn');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', dismiss);
      }

      // Green auto-dismiss timer
      if (severity === 'green') {
        var seconds = settings.green_auto_dismiss_seconds || DEFAULT_SETTINGS.green_auto_dismiss_seconds;
        autoDismissTimer = setTimeout(function () {
          removeExistingHost();
        }, seconds * 1000);
      }
    });
  }

  /**
   * Dismiss the banner.
   * Red/Amber: minimize to pill badge.
   * Green: remove entirely.
   */
  function dismiss() {
    clearAutoDismissTimer();

    if (!currentHost || !currentShadow) {
      removeExistingHost();
      return;
    }

    // Green banners just disappear
    if (currentSeverity === 'green') {
      var bannerEl = currentShadow.querySelector('.sf-banner');
      if (bannerEl) {
        bannerEl.classList.remove('sf-visible');
        var hostRef = currentHost;
        setTimeout(function () {
          if (hostRef && hostRef.parentNode) hostRef.remove();
        }, ANIMATION_DURATION_MS);
      } else {
        removeExistingHost();
      }
      currentHost = null;
      currentShadow = null;
      return;
    }

    // Red/Amber: minimize to pill
    minimizeToPill();
  }

  /**
   * Replace the full banner with a small pill badge.
   */
  function minimizeToPill() {
    if (!currentHost) return;

    var severity = currentSeverity;
    var host = currentHost;

    // Fade out the current banner
    var bannerEl = currentShadow.querySelector('.sf-banner');
    if (bannerEl) {
      bannerEl.classList.remove('sf-visible');
    }

    setTimeout(function () {
      // Rebuild shadow with pill
      if (!host.parentNode) return;

      var shadow = host.attachShadow ? null : currentShadow;
      // Since mode is 'closed' we can't re-attach; replace the host entirely
      var newHost = document.createElement('div');
      newHost.id = BANNER_HOST_ID;

      var newShadow = newHost.attachShadow({ mode: 'closed' });

      var styleEl = document.createElement('style');
      styleEl.textContent = buildShadowStyles();
      newShadow.appendChild(styleEl);

      var wrapper = document.createElement('div');
      wrapper.innerHTML = buildPillHTML(severity);
      newShadow.appendChild(wrapper.firstElementChild);

      // Replace old host with new pill host
      host.parentNode.replaceChild(newHost, host);

      currentHost = newHost;
      currentShadow = newShadow;
      isMinimized = true;

      // Animate pill in
      var pillEl = newShadow.querySelector('.sf-pill');
      if (pillEl) {
        pillEl.getBoundingClientRect();
        pillEl.classList.add('sf-visible');

        // Click pill to expand back to full banner
        pillEl.addEventListener('click', expandFromPill);
        pillEl.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            expandFromPill();
          }
        });
      }
    }, ANIMATION_DURATION_MS);
  }

  /**
   * Expand from pill badge back to full banner.
   */
  function expandFromPill() {
    if (currentSeverity && currentMessage !== undefined) {
      show({ severity: currentSeverity, message: currentMessage });
    }
  }

  /**
   * Immediately remove everything without animation.
   */
  function destroy() {
    currentSeverity = null;
    currentMessage = null;
    removeExistingHost();
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                        */
  /* ------------------------------------------------------------------ */

  window.SourceFenceBanner = {
    show: show,
    dismiss: dismiss,
    destroy: destroy,
  };
})();
