/**
 * Thin wrapper around chrome.storage.sync for user-configurable preferences
 * (currently just the "hide hybrid/non-remote roles" toggle). Uses sync
 * rather than local so the preference follows the user across signed-in
 * Chrome instances and — via chrome.storage.onChanged — updates every open
 * tab (LinkedIn and Indeed alike) the moment it's changed in one of them.
 */
(function (global) {
  const HIDE_NON_REMOTE_KEY = 'ljc_hide_non_remote';
  const DATA_CONSENT_KEY = 'ljcDataConsentV1';
  const DATA_CONSENT_STATES = new Set(['granted', 'declined']);

  async function getHideNonRemote() {
    const stored = await chrome.storage.sync.get(HIDE_NON_REMOTE_KEY);
    return Boolean(stored[HIDE_NON_REMOTE_KEY]);
  }

  async function setHideNonRemote(value) {
    await chrome.storage.sync.set({ [HIDE_NON_REMOTE_KEY]: Boolean(value) });
  }

  function onHideNonRemoteChange(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync' || !changes[HIDE_NON_REMOTE_KEY]) return;
      callback(Boolean(changes[HIDE_NON_REMOTE_KEY].newValue));
    });
  }

  /**
   * Classification consent is deliberately local rather than synced. Consent
   * given on one Chrome installation must not silently enable transmission on
   * another device. The version is part of the key so a material future change
   * can require a fresh decision without overwriting the record for this flow.
   */
  async function getDataConsent() {
    const stored = await chrome.storage.local.get(DATA_CONSENT_KEY);
    const value = stored[DATA_CONSENT_KEY];
    return DATA_CONSENT_STATES.has(value) ? value : null;
  }

  async function setDataConsent(value) {
    if (!DATA_CONSENT_STATES.has(value)) {
      throw new TypeError('Data consent must be "granted" or "declined".');
    }
    await chrome.storage.local.set({ [DATA_CONSENT_KEY]: value });
  }

  function onDataConsentChange(callback) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[DATA_CONSENT_KEY]) return;
      const value = changes[DATA_CONSENT_KEY].newValue;
      callback(DATA_CONSENT_STATES.has(value) ? value : null);
    });
  }

  global.RemoteSettings = {
    DATA_CONSENT_KEY,
    getHideNonRemote,
    setHideNonRemote,
    onHideNonRemoteChange,
    getDataConsent,
    setDataConsent,
    onDataConsentChange,
  };
})(window);
