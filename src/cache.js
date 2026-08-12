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

  function isCacheEntry(value) {
    return Boolean(value) && typeof value === 'object' && typeof value.classifiedAt === 'number';
  }

  function isFresh(entry) {
    return isCacheEntry(entry) && Date.now() - entry.classifiedAt <= TTL_MS;
  }

  // Expired entries are deleted, not merely ignored. The privacy policy states
  // cached classifications are removed after 14 days, and nothing else ever
  // reclaims them: a reader that only filtered would leave every job the user
  // ever scrolled past sitting in local storage indefinitely.
  function discard(keys) {
    if (!keys.length) return;
    Promise.resolve(chrome.storage.local.remove(keys)).catch(() => {
      // Best-effort cleanup; the entry stays expired and unusable either way,
      // and the next read of the same key will try again.
    });
  }

  async function get(jobId) {
    const key = keyFor(jobId);
    const stored = await chrome.storage.local.get(key);
    const entry = stored[key];
    if (!entry) return null;
    if (!isFresh(entry)) {
      discard([key]);
      return null;
    }
    return entry;
  }

  async function getMany(jobIds) {
    const keys = jobIds.map(keyFor);
    const stored = await chrome.storage.local.get(keys);
    const result = {};
    const expired = [];
    for (const jobId of jobIds) {
      const key = keyFor(jobId);
      const entry = stored[key];
      if (isFresh(entry)) {
        result[jobId] = entry;
      } else if (entry) {
        expired.push(key);
      }
    }
    discard(expired);
    return result;
  }

  // Sweeps entries the per-key readers above will never look at again — a job
  // the user saw once and never scrolled past a second time is only reachable
  // this way. Cheap enough to run on every page load: one storage read.
  async function purgeExpired() {
    const all = await chrome.storage.local.get(null);
    // isCacheEntry() is what makes this safe to run over the whole area: it
    // skips anything that isn't a classification record, so non-cache keys
    // sharing the prefix are never collateral damage.
    const expired = Object.keys(all).filter(
      (key) => key.startsWith(KEY_PREFIX) && isCacheEntry(all[key]) && !isFresh(all[key])
    );
    discard(expired);
    return expired.length;
  }

  async function set(jobId, result) {
    const entry = { ...result, classifiedAt: Date.now() };
    await chrome.storage.local.set({ [keyFor(jobId)]: entry });
    return entry;
  }

  global.RemoteCache = { TTL_MS, get, getMany, set, purgeExpired };
})(window);
