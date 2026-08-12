/**
 * Renders/updates the small remote-status badge on a supported job card.
 */
(function (global) {
  const CATEGORY_META = {
    TRUE_REMOTE: { emoji: '🟢', label: 'TRUE REMOTE', cls: 'ljc-true-remote' },
    REMOTE_TRAVEL: { emoji: '🟡', label: 'REMOTE + OCCASIONAL TRAVEL', cls: 'ljc-remote-travel' },
    HYBRID: { emoji: '🟠', label: 'HYBRID / OFFICE REQUIRED', cls: 'ljc-hybrid' },
    NOT_REMOTE: { emoji: '🔴', label: 'NOT REMOTE', cls: 'ljc-not-remote' },
    UNCLEAR: { emoji: '⚪', label: 'NOT STATED', cls: 'ljc-unclear' },
  };

  const BADGE_ATTR = 'data-ljc-badge';

  function insertBadge(cardEl, badge) {
    // Indeed's stable content cell keeps the badge with the title/company
    // copy and out of the save/dismiss action column.
    const indeedContent = cardEl.querySelector('.resultContent');
    if (indeedContent) {
      indeedContent.appendChild(badge);
      return;
    }

    // Classic card layout (li[data-occludable-job-id]): the outer wrapper
    // (.job-card-container) is a flex ROW whose direct children are the
    // content column and the actions column — appending directly to it
    // would add a 3rd flex item and squeeze the title/company text. Instead
    // nest inside the content column, right after the metadata footer row.
    const footer = cardEl.querySelector('.job-card-list__footer-wrapper');
    if (footer && footer.parentElement) {
      footer.insertAdjacentElement('afterend', badge);
      return;
    }
    const lockup = cardEl.querySelector('.job-card-list__entity-lockup');
    if (lockup && lockup.parentElement) {
      lockup.parentElement.appendChild(badge);
      return;
    }
    const container = cardEl.querySelector('.job-card-container');
    if (container) {
      container.appendChild(badge);
      return;
    }

    // Newer SDUI card layout: the whole card is an <a> that is itself a
    // flex ROW (icon + a flex-COLUMN content block). Same squeeze risk as
    // above, so nest inside that first child column instead of the anchor.
    if (cardEl.tagName === 'A' && cardEl.firstElementChild) {
      cardEl.firstElementChild.appendChild(badge);
      return;
    }

    // General fallback for any other flex-ROW card wrapper (e.g. the
    // "Jobs based on your preferences" split-view list, where the card is a
    // plain <div>). Appending directly here would make the badge a new flex
    // item competing for width with the content column, crushing the title
    // text down to wrapping one character per line. Nest inside the first
    // child instead, same rationale as the two cases above.
    if (cardEl.firstElementChild) {
      const style = getComputedStyle(cardEl);
      if (style.display.includes('flex') && style.flexDirection === 'row') {
        cardEl.firstElementChild.appendChild(badge);
        return;
      }
    }

    cardEl.appendChild(badge);
  }

  function ensureBadgeEl(cardEl) {
    let badge = cardEl.querySelector(`[${BADGE_ATTR}]`);
    if (badge) return badge;

    badge = document.createElement('div');
    badge.setAttribute(BADGE_ATTR, 'true');
    badge.className = 'ljc-badge';

    const pill = document.createElement('span');
    pill.className = 'ljc-badge__pill';
    badge.appendChild(pill);

    const reason = document.createElement('span');
    reason.className = 'ljc-badge__reason';
    badge.appendChild(reason);

    insertBadge(cardEl, badge);
    return badge;
  }

  function render(cardEl, state) {
    if (!cardEl || !cardEl.isConnected) return;
    const badge = ensureBadgeEl(cardEl);
    const pill = badge.querySelector('.ljc-badge__pill');
    const reasonEl = badge.querySelector('.ljc-badge__reason');

    badge.classList.remove(
      'ljc-badge--loading',
      'ljc-badge--error',
      ...Object.values(CATEGORY_META).map((m) => 'ljc-badge--' + m.cls)
    );

    if (state.status === 'loading') {
      badge.classList.add('ljc-badge--loading');
      pill.textContent = '⏳ Checking remote status…';
      reasonEl.textContent = '';
      return;
    }

    if (state.status === 'error') {
      badge.classList.add('ljc-badge--error');
      pill.textContent = '⚪ NOT STATED';
      reasonEl.textContent = 'Could not load the job description.';
      return;
    }

    const meta = CATEGORY_META[state.category] || CATEGORY_META.UNCLEAR;
    badge.classList.add('ljc-badge--' + meta.cls);
    const label =
      state.category === 'REMOTE_TRAVEL' && state.cadence
        ? `REMOTE (${state.cadence} office visit)`
        : meta.label;
    pill.textContent = `${meta.emoji} ${label}`;
    reasonEl.textContent = state.reason ? `· ${state.reason}` : '';

    // The reason line is truncated to one line by CSS — surface a hover
    // affordance so it's obvious the full requirement text is one hover
    // away (shown via the native title tooltip on the whole badge).
    const hasReason = Boolean(state.reason);
    pill.classList.toggle('ljc-badge__pill--hint', hasReason);
    reasonEl.classList.toggle('ljc-badge__reason--hint', hasReason);
    badge.title = hasReason ? `Why: ${state.reason}` : label;
  }

  global.RemoteBadge = { render, CATEGORY_META };
})(window);
