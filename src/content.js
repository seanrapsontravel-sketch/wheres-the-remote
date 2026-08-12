/**
 * Orchestrates the shared flow on supported job-board pages:
 *  - finds job cards currently in the DOM
 *  - shows a cached result instantly if we've seen the job before
 *  - otherwise queues the job for background analysis (bounded concurrency)
 *  - keeps watching the DOM/URL so pagination, filter changes and new
 *    searches (including client-side navigations) get picked up
 *    without the user doing anything.
 */
(function () {
  // Must match EXTRACTOR_FRAME_NAME in extractor.js. The extractor points its
  // own hidden iframe at a real board URL that can itself contain job cards
  // (see the comment on EXTRACTOR_FRAME_NAME), which content_scripts'
  // all_frames:true would otherwise inject this whole orchestrator into,
  // recursively spawning further extraction iframes. Bail out before doing
  // anything else if this document is one of our own extraction frames.
  if (window.name === 'LJC_EXTRACTOR_FRAME') return;

  if (!window.RemoteSite) return;

  // Declarative injection and the service-worker recovery path can race when
  // an existing tab is restored. Only one orchestrator should own the page's
  // observers, timers and queue.
  if (window.__REAL_REMOTE_JOB_CHECKER_ACTIVE__) return;
  window.__REAL_REMOTE_JOB_CHECKER_ACTIVE__ = true;

  const MAX_CONCURRENT = 4;
  const RESCAN_DEBOUNCE_MS = 300;
  const FALLBACK_RESCAN_MS = 2500;
  const RECOVERY_RELOAD_KEY = 'ljc_last_context_recovery';
  const RECOVERY_RELOAD_COOLDOWN_MS = 15000;

  const sessionResults = new Map(); // jobId -> classification state (final, this page load)
  const platformLabels = new Map(); // jobId -> job board's Remote/Hybrid/On-site label
  const inFlight = new Map(); // jobId -> Promise
  const queue = [];
  const queued = new Set();
  let running = 0;

  // Reloading the extension (e.g. during development) orphans any content
  // script already injected into an open tab: it keeps running, but every
  // chrome.* call now throws "Extension context invalidated" — and would do
  // so forever, once per scan tick, since nothing else tells the script to
  // stop. Detect that specific error the first time it happens and tear
  // down the observer/timers so the script quietly goes idle instead of
  // spamming rejected promises until the tab is refreshed.
  let torndown = false;
  let recoveryStarted = false;

  function isContextInvalidatedError(err) {
    return !!(err && /Extension context invalidated/i.test(err.message || String(err)));
  }

  function teardown() {
    if (torndown) return;
    torndown = true;
    observer.disconnect();
    clearInterval(fallbackIntervalId);
    if (debounceTimer) clearTimeout(debounceTimer);
  }

  function showRecoveryNotice() {
    if (document.querySelector('[data-ljc-recovery]')) return;
    const notice = document.createElement('div');
    notice.setAttribute('data-ljc-recovery', 'true');
    notice.className = 'ljc-recovery';

    const message = document.createElement('span');
    message.textContent = 'Remote checker updated and needs to reconnect.';
    notice.appendChild(message);

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Refresh page';
    button.addEventListener('click', () => location.reload());
    notice.appendChild(button);
    document.body.appendChild(notice);
  }

  function recoverFromInvalidatedContext() {
    if (recoveryStarted) return;
    recoveryStarted = true;
    teardown();

    // Reload once so Chrome injects the current extension scripts into tabs
    // restored from back/forward cache or left open during an extension
    // update. A cooldown prevents a broken install from creating a loop; in
    // that unlikely case, leave a clear manual recovery control instead.
    try {
      const lastReload = Number(sessionStorage.getItem(RECOVERY_RELOAD_KEY) || 0);
      if (!lastReload || Date.now() - lastReload > RECOVERY_RELOAD_COOLDOWN_MS) {
        sessionStorage.setItem(RECOVERY_RELOAD_KEY, String(Date.now()));
        location.reload();
        return;
      }
    } catch (e) {
      // Storage can be unavailable under unusually strict browser settings.
    }

    showRecoveryNotice();
  }

  function findJobCardElements() {
    return RemoteSite.findJobCardElements();
  }

  function cardsFor(jobId) {
    return RemoteSite.cardsFor(jobId);
  }

  function cardTextWithoutCheckerUi(card) {
    const clone = card.cloneNode(true);
    clone.querySelectorAll('[data-ljc-badge], [data-ljc-summary]').forEach((el) => el.remove());
    return clone.innerText || clone.textContent || '';
  }

  function rememberPlatformLabel(jobId, card) {
    const label = RemoteSite.platformLabelForCard
      ? RemoteSite.platformLabelForCard(card)
      : RemoteAggregate.platformLabelFromText(cardTextWithoutCheckerUi(card));
    if (label) platformLabels.set(jobId, label);
  }

  let summaryEl = null;

  function ensureSummaryEl(cards) {
    const firstCard = cards && cards[0];
    if (!firstCard || !firstCard.parentElement) {
      if (summaryEl && summaryEl.isConnected) summaryEl.remove();
      return null;
    }

    const placement = RemoteSite.summaryPlacement(firstCard);
    const parent = placement && placement.parent;
    const anchor = placement && placement.anchor;
    if (!parent || !anchor) return null;
    if (summaryEl && summaryEl.isConnected && summaryEl.parentElement === parent) return summaryEl;
    if (summaryEl && summaryEl.isConnected) summaryEl.remove();

    summaryEl = document.createElement(parent.tagName === 'UL' || parent.tagName === 'OL' ? 'li' : 'div');
    summaryEl.setAttribute('data-ljc-summary', 'true');
    summaryEl.className = 'ljc-summary';
    summaryEl.setAttribute('role', 'status');
    summaryEl.setAttribute('aria-live', 'polite');
    summaryEl.innerHTML = `
      <div class="ljc-summary__header">
        <span class="ljc-summary__title">Remote reality</span>
        <span class="ljc-summary__progress"></span>
      </div>
      <div class="ljc-summary__stats">
        <span class="ljc-summary__stat ljc-summary__stat--remote"></span>
        <span class="ljc-summary__stat ljc-summary__stat--travel"></span>
        <span class="ljc-summary__stat ljc-summary__stat--office"></span>
        <span class="ljc-summary__stat ljc-summary__stat--unclear"></span>
      </div>
      <div class="ljc-summary__insight"></div>`;
    parent.insertBefore(summaryEl, anchor);
    return summaryEl;
  }

  function updateAggregateSummary(cards) {
    const currentCards = cards || findJobCardElements();
    const unique = new Map();

    for (const card of currentCards) {
      const jobId = RemoteSite.extractJobId(card);
      if (!jobId || unique.has(jobId)) continue;
      rememberPlatformLabel(jobId, card);
      unique.set(jobId, {
        platformLabel: platformLabels.get(jobId) || null,
        state: sessionResults.get(jobId) || (inFlight.has(jobId) || queued.has(jobId) ? { status: 'loading' } : null),
      });
    }

    const el = ensureSummaryEl(
      Array.from(unique.keys()).map((jobId) =>
        currentCards.find((card) => RemoteSite.extractJobId(card) === jobId)
      )
    );
    if (!el) return;

    const summary = RemoteAggregate.summarize(Array.from(unique.values()));
    const failedText = summary.errors ? ` · ${summary.errors} failed` : '';
    el.querySelector('.ljc-summary__progress').textContent = `${summary.checked} of ${summary.totalCards} checked${failedText}`;
    el.querySelector('.ljc-summary__stat--remote').textContent = `🟢 True remote ${summary.trueRemote}`;
    el.querySelector('.ljc-summary__stat--travel').textContent = `🟡 Remote + travel ${summary.remoteTravel}`;
    el.querySelector('.ljc-summary__stat--office').textContent = `🟠 Office required ${summary.officeRequired}`;
    el.querySelector('.ljc-summary__stat--unclear').textContent = `⚪ Not stated ${summary.notStated}`;
    el.querySelector('.ljc-summary__insight').textContent = RemoteAggregate.remoteInsight(
      summary,
      RemoteSite.platformName
    );
  }

  function applyState(jobId, state) {
    sessionResults.set(jobId, state);
    cardsFor(jobId).forEach((card) => RemoteBadge.render(card, state));
    updateAggregateSummary();
  }

  function showLoading(jobId) {
    cardsFor(jobId).forEach((card) => RemoteBadge.render(card, { status: 'loading' }));
  }

  async function runJob(jobId) {
    try {
      const description = await RemoteExtractor.fetchDescription(jobId);
      if (!description) {
        applyState(jobId, { status: 'error' });
        return;
      }
      const classification = await RemoteClassifier.classifyWithFallback(description);
      const state = {
        status: 'done',
        category: classification.category,
        reason: classification.reason,
        cadence: classification.cadence,
      };
      await RemoteCache.set(RemoteSite.cacheJobId(jobId), {
        category: classification.category,
        reason: classification.reason,
        cadence: classification.cadence,
      });
      applyState(jobId, state);
    } catch (err) {
      if (isContextInvalidatedError(err)) {
        recoverFromInvalidatedContext();
        return;
      }
      applyState(jobId, { status: 'error' });
    }
  }

  function pump() {
    while (running < MAX_CONCURRENT && queue.length > 0) {
      const jobId = queue.shift();
      queued.delete(jobId);
      running++;
      const promise = runJob(jobId).finally(() => {
        running--;
        inFlight.delete(jobId);
        pump();
      });
      inFlight.set(jobId, promise);
    }
  }

  function enqueue(jobId) {
    if (inFlight.has(jobId) || queued.has(jobId)) return;
    queued.add(jobId);
    queue.push(jobId);
    pump();
  }

  async function processCard(card) {
    const jobId = RemoteSite.extractJobId(card);
    if (!jobId) return;
    rememberPlatformLabel(jobId, card);

    if (sessionResults.has(jobId)) {
      RemoteBadge.render(card, sessionResults.get(jobId));
      updateAggregateSummary();
      return;
    }

    if (inFlight.has(jobId) || queued.has(jobId)) {
      RemoteBadge.render(card, { status: 'loading' });
      updateAggregateSummary();
      return;
    }

    // Not yet handled this session — show a loading badge right away so the
    // user sees progress, then check the persistent cache before fetching.
    RemoteBadge.render(card, { status: 'loading' });
    updateAggregateSummary();

    const cached = await RemoteCache.get(RemoteSite.cacheJobId(jobId));
    if (cached) {
      const state = { status: 'done', category: cached.category, reason: cached.reason, cadence: cached.cadence };
      sessionResults.set(jobId, state);
      cardsFor(jobId).forEach((c) => RemoteBadge.render(c, state));
      updateAggregateSummary();
      return;
    }

    enqueue(jobId);
  }

  function scan() {
    if (torndown) return;
    const cards = findJobCardElements();
    cards.forEach((card) => {
      if (card.querySelector('[data-ljc-badge]')) return; // already badged
      processCard(card).catch((err) => {
        if (isContextInvalidatedError(err)) recoverFromInvalidatedContext();
      });
    });
    updateAggregateSummary(cards);
  }

  let debounceTimer = null;
  function scheduleScan() {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scan, RESCAN_DEBOUNCE_MS);
  }

  // --- Watch for client-side DOM updates ----------------------------------

  const observer = new MutationObserver(() => scheduleScan());
  observer.observe(document.body, { childList: true, subtree: true });

  // --- Watch for SPA navigations (pagination, new searches, filters) ------

  let lastUrl = location.href;
  function onPossibleNavigation() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      scheduleScan();
    }
  }

  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    onPossibleNavigation();
  };
  const originalReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    originalReplaceState.apply(this, args);
    onPossibleNavigation();
  };
  window.addEventListener('popstate', onPossibleNavigation);

  // Defensive backstop in case an update slips past the observer/URL hooks.
  const fallbackIntervalId = setInterval(scheduleScan, FALLBACK_RESCAN_MS);

  // Initial pass.
  scheduleScan();
})();
