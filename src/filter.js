/**
 * Decides whether a classified job card should be hidden when the user has
 * the "hide hybrid/non-remote roles" preference on, and applies that
 * decision to the DOM.
 */
(function (global) {
  const HIDDEN_CATEGORIES = new Set(['HYBRID', 'NOT_REMOTE']);
  const FADE_MS = 200;

  // Pure so it can be unit-tested the same way as RemoteAggregate — no DOM,
  // no chrome.* calls. Loading/error states and every other category are
  // always shown regardless of the preference.
  function shouldHide(state, enabled) {
    if (!enabled || !state || state.status !== 'done') return false;
    return HIDDEN_CATEGORIES.has(state.category);
  }

  // Hiding fades the card out first, then collapses it a frame after the CSS
  // transition ends. That delay has to be cancellable: a user who unticks the
  // preference mid-fade would otherwise have the card collapsed out from
  // under them 200ms later, by a timer nothing was tracking. Keyed weakly so
  // cards removed from the DOM by the job board's own re-render don't pin
  // their elements in memory.
  const pendingFades = new WeakMap();

  function cancelPendingFade(cardEl) {
    const timer = pendingFades.get(cardEl);
    if (timer === undefined) return;
    global.clearTimeout(timer);
    pendingFades.delete(cardEl);
  }

  function applyVisibility(cardEl, hidden) {
    if (!cardEl) return;
    if (hidden) {
      // Already collapsed, or a fade is already in flight — don't restart it.
      if (cardEl.classList.contains('ljc-hidden') || pendingFades.has(cardEl)) return;
      cardEl.classList.add('ljc-hiding');
      pendingFades.set(
        cardEl,
        global.setTimeout(() => {
          pendingFades.delete(cardEl);
          cardEl.classList.add('ljc-hidden');
        }, FADE_MS)
      );
    } else {
      cancelPendingFade(cardEl);
      cardEl.classList.remove('ljc-hiding', 'ljc-hidden');
    }
  }

  global.RemoteFilter = { HIDDEN_CATEGORIES, FADE_MS, shouldHide, applyVisibility };
})(window);
