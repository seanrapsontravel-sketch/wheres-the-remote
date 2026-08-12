/**
 * Thin wrapper around chrome.storage.local for caching classification
 * results per platform-scoped job ID, so a job already analysed once is applied
 * instantly if it's seen again (same page, pagination, or a later visit).
 */
(function (global) {
  // Preserve the original prefix so existing users keep their cached results.
  const KEY_PREFIX = 'ljc_';
  const TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days — descriptions can change.

  function keyFor(jobId) {
    return KEY_PREFIX + jobId;
  }

  async function get(jobId) {
    const key = keyFor(jobId);
    const stored = await chrome.storage.local.get(key);
    const entry = stored[key];
    if (!entry) return null;
    if (Date.now() - entry.classifiedAt > TTL_MS) return null;
    return entry;
  }

  async function getMany(jobIds) {
    const keys = jobIds.map(keyFor);
    const stored = await chrome.storage.local.get(keys);
    const result = {};
    for (const jobId of jobIds) {
      const entry = stored[keyFor(jobId)];
      if (entry && Date.now() - entry.classifiedAt <= TTL_MS) {
        result[jobId] = entry;
      }
    }
    return result;
  }

  async function set(jobId, result) {
    const entry = { ...result, classifiedAt: Date.now() };
    await chrome.storage.local.set({ [keyFor(jobId)]: entry });
    return entry;
  }

  global.RemoteCache = { get, getMany, set };
})(window);
