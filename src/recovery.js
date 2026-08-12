/**
 * Reconnects the checker to supported tabs that were already open when the
 * extension started or was reloaded, and to tabs that navigate into a
 * supported job board via client-side (SPA) routing while the extension is
 * already running.
 *
 * Chrome only auto-injects manifest content scripts on a real navigation
 * (document load). LinkedIn and Indeed are both SPAs: clicking from an
 * unsupported page (e.g. the LinkedIn feed) into Jobs is a pushState/
 * replaceState route change, not a document load, so the declarative
 * content_scripts entry never fires for that tab — the checker silently
 * never starts until the user hard-refreshes. onHistoryStateUpdated below
 * closes that gap the same way onInstalled/onStartup close the
 * restored-tab gap.
 */
(function (global) {
  const SUPPORTED_TAB_URLS = [
    'https://www.linkedin.com/jobs/*',
    'https://www.linkedin.com/preload/*',
    'https://*.indeed.com/*',
  ];

  const CONTENT_SCRIPT_FILES = [
    'src/site.js',
    'src/classifier.js',
    'src/cache.js',
    'src/extractor.js',
    'src/badge.js',
    'src/aggregate.js',
    'src/content.js',
  ];

  async function contentScriptIsActive(tabId) {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(globalThis.__REAL_REMOTE_JOB_CHECKER_ACTIVE__),
    });
    return results.some((result) => result.frameId === 0 && result.result === true);
  }

  async function ensureContentScript(tab) {
    if (!tab || typeof tab.id !== 'number') return false;
    if (await contentScriptIsActive(tab.id)) return false;

    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ['src/badge.css'],
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: CONTENT_SCRIPT_FILES,
    });
    return true;
  }

  async function recoverExistingJobTabs() {
    const tabs = await chrome.tabs.query({ url: SUPPORTED_TAB_URLS });
    // A tab can close, navigate, or become restricted between query and
    // injection. One such race must not prevent recovery in the other tabs.
    await Promise.allSettled(tabs.map((tab) => ensureContentScript(tab)));
  }

  function recoverSilently() {
    recoverExistingJobTabs().catch(() => {
      // The normal manifest injection remains the fallback on next navigation.
    });
  }

  chrome.runtime.onInstalled.addListener(recoverSilently);
  chrome.runtime.onStartup.addListener(recoverSilently);

  // Also cover a service worker that starts for another reason after the
  // relevant browser event has already passed.
  recoverSilently();

  // Matches SUPPORTED_TAB_URLS above, expressed as webNavigation UrlFilters
  // (a different filter shape than content_scripts match patterns).
  const HISTORY_UPDATE_FILTER = {
    url: [
      { hostEquals: 'www.linkedin.com', pathPrefix: '/jobs/' },
      { hostEquals: 'www.linkedin.com', pathPrefix: '/preload/' },
      { hostSuffix: '.indeed.com' },
      { hostEquals: 'indeed.com' },
    ],
  };

  function recoverTabSilently(tabId) {
    return ensureContentScript({ id: tabId }).catch(() => {
      // A tab that closed or navigated away between the event and injection
      // must not prevent recovery elsewhere.
    });
  }

  chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (details.frameId !== 0) return; // Only the top-level SPA route matters here.
    return recoverTabSilently(details.tabId);
  }, HISTORY_UPDATE_FILTER);

  global.RemoteContentRecovery = {
    ensureContentScript,
    recoverExistingJobTabs,
  };
})(self);
