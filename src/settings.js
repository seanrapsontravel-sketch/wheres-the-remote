/**
 * Thin wrapper around chrome.storage.sync for user-configurable preferences
 * (currently just the "hide hybrid/non-remote roles" toggle). Uses sync
 * rather than local so the preference follows the user across signed-in
 * Chrome instances and — via chrome.storage.onChanged — updates every open
 * tab (LinkedIn and Indeed alike) the moment it's changed in one of them.
 */
(function (global) {
  const HIDE_NON_REMOTE_KEY = 'ljc_hide_non_remote';

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

  global.RemoteSettings = { getHideNonRemote, setHideNonRemote, onHideNonRemoteChange };
})(window);
