'use strict';

// ---------------------------------------------------------------------------
// SourceFence — Lightweight Supabase REST Client
// ---------------------------------------------------------------------------
// Minimal Supabase wrapper for the Chrome extension. No npm, no bundler.
// Works in both content script and service worker contexts.
// Uses fetch() to call the Supabase REST API directly.
// ---------------------------------------------------------------------------

const SupabaseClient = (function () {
  // ---- Internal state ----------------------------------------------------

  const CONFIG_KEY = 'sourcefence_backend_config';
  const SESSION_KEY = 'sourcefence_session';

  let _config = null;   // { supabase_url, supabase_anon_key }
  let _session = null;  // { access_token, refresh_token, user, expires_at }

  // ---- Helpers -----------------------------------------------------------

  /**
   * Read a value from chrome.storage.local.
   * @param {string} key
   * @returns {Promise<*>}
   */
  function storageGet(key) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(key, function (result) {
        resolve(result[key] || null);
      });
    });
  }

  /**
   * Write a value to chrome.storage.local.
   * @param {string} key
   * @param {*} value
   * @returns {Promise<void>}
   */
  function storageSet(key, value) {
    return new Promise(function (resolve) {
      const update = {};
      update[key] = value;
      chrome.storage.local.set(update, resolve);
    });
  }

  /**
   * Remove a key from chrome.storage.local.
   * @param {string} key
   * @returns {Promise<void>}
   */
  function storageRemove(key) {
    return new Promise(function (resolve) {
      chrome.storage.local.remove(key, resolve);
    });
  }

  /**
   * Build common request headers for Supabase calls.
   * @param {boolean} [includeAuth=true] - Whether to include the Authorization header.
   * @returns {object}
   */
  function buildHeaders(includeAuth) {
    if (includeAuth === undefined) includeAuth = true;

    var headers = {
      'Content-Type': 'application/json',
      'apikey': _config.supabase_anon_key,
    };

    if (includeAuth && _session && _session.access_token) {
      headers['Authorization'] = 'Bearer ' + _session.access_token;
    }

    return headers;
  }

  /**
   * Make a fetch request to Supabase. If a 401 is returned, attempt a token
   * refresh and retry the request once.
   *
   * @param {string} path      - Relative path (e.g. /rest/v1/location_rules)
   * @param {object} [options] - Fetch options (method, body, headers, etc.)
   * @param {boolean} [isRetry] - Internal flag to prevent infinite retry loops.
   * @returns {Promise<Response>}
   */
  async function supabaseFetch(path, options, isRetry) {
    if (!_config || !_config.supabase_url) {
      throw new Error('SupabaseClient: Not configured. Call init() first.');
    }

    var url = _config.supabase_url.replace(/\/+$/, '') + path;

    options = options || {};
    options.headers = Object.assign({}, buildHeaders(true), options.headers || {});

    var response = await fetch(url, options);

    // Handle 401 — attempt token refresh once
    if (response.status === 401 && !isRetry && _session && _session.refresh_token) {
      console.log('[SupabaseClient] 401 received — attempting token refresh.');
      var refreshed = await refreshSession();
      if (refreshed) {
        // Retry with the new token
        options.headers['Authorization'] = 'Bearer ' + _session.access_token;
        return fetch(url, options);
      }
    }

    return response;
  }

  // ---- Public API --------------------------------------------------------

  /**
   * Load config and session from chrome.storage.local.
   * Must be called before any other method.
   */
  async function init() {
    _config = await storageGet(CONFIG_KEY);
    _session = await storageGet(SESSION_KEY);
    console.log(
      '[SupabaseClient] Initialized.',
      'Configured:', !!(_config && _config.supabase_url),
      'Session:', !!(_session && _session.access_token)
    );
  }

  /**
   * Returns true if a Supabase URL and anon key are configured.
   * @returns {boolean}
   */
  function isConfigured() {
    return !!(
      _config &&
      _config.supabase_url &&
      _config.supabase_anon_key
    );
  }

  /**
   * Returns true if there is a stored session with an access token.
   * @returns {boolean}
   */
  function hasSession() {
    return !!(_session && _session.access_token);
  }

  /**
   * Sign in with email and password via the Supabase Auth REST API.
   *
   * @param {string} email
   * @param {string} password
   * @returns {Promise<{ok: boolean, user?: object, error?: string}>}
   */
  async function signIn(email, password) {
    if (!isConfigured()) {
      return { ok: false, error: 'Backend not configured.' };
    }

    try {
      var url = _config.supabase_url.replace(/\/+$/, '') + '/auth/v1/token?grant_type=password';
      var response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': _config.supabase_anon_key,
        },
        body: JSON.stringify({ email: email, password: password }),
      });

      var data = await response.json();

      if (!response.ok) {
        return {
          ok: false,
          error: data.error_description || data.msg || data.error || 'Sign-in failed.',
        };
      }

      _session = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at,
        user: data.user || null,
      };

      await storageSet(SESSION_KEY, _session);
      console.log('[SupabaseClient] Signed in as', (_session.user && _session.user.email) || email);

      return { ok: true, user: _session.user };
    } catch (err) {
      console.error('[SupabaseClient] signIn error:', err);
      return { ok: false, error: err.message || 'Network error during sign-in.' };
    }
  }

  /**
   * Sign out the current user. Calls the Supabase logout endpoint
   * and clears the stored session.
   *
   * @returns {Promise<{ok: boolean}>}
   */
  async function signOut() {
    try {
      if (isConfigured() && _session && _session.access_token) {
        var url = _config.supabase_url.replace(/\/+$/, '') + '/auth/v1/logout';
        await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': _config.supabase_anon_key,
            'Authorization': 'Bearer ' + _session.access_token,
          },
        }).catch(function () {
          // Best-effort — ignore network errors on logout.
        });
      }
    } catch (e) {
      // Ignore errors during logout.
    }

    _session = null;
    await storageRemove(SESSION_KEY);
    console.log('[SupabaseClient] Signed out.');
    return { ok: true };
  }

  /**
   * Return the stored session (or null).
   * @returns {Promise<object|null>}
   */
  async function getSession() {
    if (!_session) {
      _session = await storageGet(SESSION_KEY);
    }
    return _session;
  }

  /**
   * Refresh the session using the stored refresh_token.
   *
   * @returns {Promise<boolean>} true if refresh succeeded, false otherwise.
   */
  async function refreshSession() {
    if (!isConfigured()) return false;
    if (!_session || !_session.refresh_token) return false;

    try {
      var url = _config.supabase_url.replace(/\/+$/, '') + '/auth/v1/token?grant_type=refresh_token';
      var response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': _config.supabase_anon_key,
        },
        body: JSON.stringify({ refresh_token: _session.refresh_token }),
      });

      if (!response.ok) {
        console.warn('[SupabaseClient] Token refresh failed:', response.status);
        // Clear invalid session
        _session = null;
        await storageRemove(SESSION_KEY);
        return false;
      }

      var data = await response.json();

      _session = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at,
        user: data.user || _session.user,
      };

      await storageSet(SESSION_KEY, _session);
      console.log('[SupabaseClient] Session refreshed.');
      return true;
    } catch (err) {
      console.error('[SupabaseClient] refreshSession error:', err);
      return false;
    }
  }

  /**
   * Fetch active location rules from Supabase.
   *
   * @returns {Promise<{ok: boolean, data?: Array, error?: string}>}
   */
  async function fetchLocationRules() {
    try {
      var response = await supabaseFetch(
        '/rest/v1/location_rules?active=eq.true&select=*',
        { method: 'GET' }
      );

      if (!response.ok) {
        var errBody = await response.text();
        return { ok: false, error: 'HTTP ' + response.status + ': ' + errBody };
      }

      var data = await response.json();
      return { ok: true, data: data };
    } catch (err) {
      console.error('[SupabaseClient] fetchLocationRules error:', err);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Fetch active company rules from Supabase.
   *
   * @returns {Promise<{ok: boolean, data?: Array, error?: string}>}
   */
  async function fetchCompanyRules() {
    try {
      var response = await supabaseFetch(
        '/rest/v1/company_rules?active=eq.true&select=*',
        { method: 'GET' }
      );

      if (!response.ok) {
        var errBody = await response.text();
        return { ok: false, error: 'HTTP ' + response.status + ': ' + errBody };
      }

      var data = await response.json();
      return { ok: true, data: data };
    } catch (err) {
      console.error('[SupabaseClient] fetchCompanyRules error:', err);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Fetch team info for the current user from Supabase.
   *
   * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
   */
  async function fetchTeamInfo() {
    if (!_session || !_session.user || !_session.user.id) {
      return { ok: false, error: 'No authenticated user.' };
    }

    try {
      var userId = _session.user.id;
      var response = await supabaseFetch(
        '/rest/v1/team_members?user_id=eq.' + userId + '&select=*,teams(*)',
        { method: 'GET' }
      );

      if (!response.ok) {
        var errBody = await response.text();
        return { ok: false, error: 'HTTP ' + response.status + ': ' + errBody };
      }

      var data = await response.json();
      return { ok: true, data: data };
    } catch (err) {
      console.error('[SupabaseClient] fetchTeamInfo error:', err);
      return { ok: false, error: err.message };
    }
  }

  // ---- Expose public interface -------------------------------------------

  return {
    init: init,
    isConfigured: isConfigured,
    hasSession: hasSession,
    signIn: signIn,
    signOut: signOut,
    getSession: getSession,
    refreshSession: refreshSession,
    fetchLocationRules: fetchLocationRules,
    fetchCompanyRules: fetchCompanyRules,
    fetchTeamInfo: fetchTeamInfo,
  };
})();

// Make available on window for content scripts
if (typeof window !== 'undefined') {
  window.SupabaseClient = SupabaseClient;
}
