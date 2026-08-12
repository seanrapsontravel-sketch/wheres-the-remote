/**
 * Site adapters for the job boards supported by the extension.
 *
 * Everything that depends on a job board's DOM or URL shape lives here so
 * the queue, cache, classifier and badge orchestration can stay shared.
 */
(function (global) {
  const host = location.hostname.toLowerCase();

  function unique(elements) {
    return Array.from(new Set(elements.filter(Boolean)));
  }

  function escape(value) {
    return CSS.escape(String(value));
  }

  // --- LinkedIn ----------------------------------------------------------

  const LINKEDIN_CLASSIC_CARD_SELECTOR = 'li[data-occludable-job-id]';
  const LINKEDIN_SDUI_CARD_SELECTOR = 'a[href*="currentJobId="]';
  const LINKEDIN_PREFERENCE_CARD_SELECTOR = '[componentkey^="job-card-component-ref-"]';
  const LINKEDIN_VIEW_CARD_SELECTOR = '[data-view-name="job-card"]';
  const LINKEDIN_VIEW_CARD_LINK_SELECTOR =
    'a.job-card-list__title--link[href*="currentJobId="]';

  function linkedinJobIdFromUrl(href) {
    try {
      const url = new URL(href, location.href);
      const fromParam = url.searchParams.get('currentJobId');
      if (fromParam) return fromParam;
      const fromPath = url.pathname.match(/\/jobs\/view\/(\d+)/);
      if (fromPath) return fromPath[1];
    } catch (e) {
      // Not a usable job-card link.
    }
    return null;
  }

  function linkedinExtractJobId(el) {
    if (el.hasAttribute('data-occludable-job-id')) {
      return el.getAttribute('data-occludable-job-id');
    }

    const componentKey = el.getAttribute('componentkey');
    if (componentKey) {
      const match = componentKey.match(/^job-card-component-ref-(\d+)$/);
      if (match) return match[1];
    }

    if (el.tagName === 'A') {
      return linkedinJobIdFromUrl(el.href);
    }

    // LinkedIn's continuously-loaded recommendation modules use a generic
    // `data-job-id="search"` on the card itself. The real numeric ID only
    // appears in the nested title link's currentJobId query parameter.
    const titleLink = el.querySelector && el.querySelector(LINKEDIN_VIEW_CARD_LINK_SELECTOR);
    if (titleLink) return linkedinJobIdFromUrl(titleLink.href);

    return null;
  }

  function isGenuineLinkedinSduiCard(el) {
    if (!el.querySelector('img')) return false;
    if (el.closest(LINKEDIN_PREFERENCE_CARD_SELECTOR)) return false;
    const clone = el.cloneNode(true);
    clone.querySelectorAll('[data-ljc-badge]').forEach((badge) => badge.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim().length >= 20;
  }

  function isTopLevelLinkedinPreferenceCard(el) {
    return !el.parentElement || !el.parentElement.closest(LINKEDIN_PREFERENCE_CARD_SELECTOR);
  }

  function linkedinFindCards() {
    const classic = Array.from(document.querySelectorAll(LINKEDIN_CLASSIC_CARD_SELECTOR));
    const sdui = Array.from(document.querySelectorAll(LINKEDIN_SDUI_CARD_SELECTOR)).filter(
      isGenuineLinkedinSduiCard
    );
    const preference = Array.from(document.querySelectorAll(LINKEDIN_PREFERENCE_CARD_SELECTOR)).filter(
      isTopLevelLinkedinPreferenceCard
    );
    const viewCards = Array.from(document.querySelectorAll(LINKEDIN_VIEW_CARD_SELECTOR)).filter(
      (card) => !card.closest(LINKEDIN_CLASSIC_CARD_SELECTOR) && linkedinExtractJobId(card)
    );
    return unique(classic.concat(sdui, preference, viewCards));
  }

  function linkedinFindConsentAnchors() {
    // Before opt-in, inspect only the minimum structural signals needed to
    // place the activation card. Do not clone or read card text and do not
    // extract job IDs.
    const classic = Array.from(document.querySelectorAll(LINKEDIN_CLASSIC_CARD_SELECTOR));
    const preference = Array.from(document.querySelectorAll(LINKEDIN_PREFERENCE_CARD_SELECTOR)).filter(
      isTopLevelLinkedinPreferenceCard
    );
    const viewCards = Array.from(document.querySelectorAll(LINKEDIN_VIEW_CARD_SELECTOR)).filter(
      (card) => !card.closest(LINKEDIN_CLASSIC_CARD_SELECTOR)
    );
    const sdui = Array.from(document.querySelectorAll(LINKEDIN_SDUI_CARD_SELECTOR)).filter(
      (card) => card.querySelector('img') && !card.closest(LINKEDIN_PREFERENCE_CARD_SELECTOR)
    );
    return unique(classic.concat(preference, viewCards, sdui));
  }

  function linkedinCardsFor(jobId) {
    return linkedinFindCards().filter((card) => linkedinExtractJobId(card) === String(jobId));
  }

  function linkedinSummaryPlacement(firstCard) {
    const resultsContainer = firstCard.closest('[componentkey="SearchResultsMainContent"]');
    let anchor = firstCard;
    if (resultsContainer) {
      while (anchor.parentElement && anchor.parentElement !== resultsContainer) {
        anchor = anchor.parentElement;
      }
    }
    return { parent: resultsContainer || firstCard.parentElement, anchor };
  }

  const linkedin = {
    id: 'linkedin',
    platformName: 'LinkedIn',
    extractJobId: linkedinExtractJobId,
    findJobCardElements: linkedinFindCards,
    findConsentAnchorElements: linkedinFindConsentAnchors,
    cardsFor: linkedinCardsFor,
    summaryPlacement: linkedinSummaryPlacement,
    cacheJobId(jobId) {
      // Preserve the v1 cache keys for existing LinkedIn classifications.
      return String(jobId);
    },
    jobUrl(jobId) {
      return `https://www.linkedin.com/jobs/view/${encodeURIComponent(jobId)}/`;
    },
    descriptionFromDocument(doc, jobId) {
      const el = doc.getElementById(`JobDetails_AboutTheJob_${jobId}`);
      return el && el.innerText ? el.innerText.trim() : null;
    },
    pageIsUnavailable(bodyText) {
      return /no longer accepting|this job (is|was) no longer available|page not found/i.test(bodyText);
    },
  };

  // --- Indeed ------------------------------------------------------------

  const INDEED_TITLE_SELECTOR =
    'a.jcs-JobTitle[data-jk], a[data-jk][aria-label^="full details of "]';

  function indeedCardFromTitle(title) {
    return (
      title.closest('.job_seen_beacon') ||
      title.closest('[data-testid="slider_item"]') ||
      title.closest('.result') ||
      title.closest('li') ||
      title
    );
  }

  function isVisibleIndeedCard(card) {
    // Indeed places zero-size decoy result nodes in the DOM. They are not
    // presented to the user and their synthetic job keys do not resolve, so
    // analysing them would inflate the summary and create a guaranteed error.
    if (!card || typeof card.getBoundingClientRect !== 'function') return true;

    // A card this extension hid is 0x0 by our own doing — `ljc-hidden` sets
    // display:none. Measuring it here would confuse "the user asked us to
    // hide this" with "Indeed rendered a decoy", and the consequence is not
    // cosmetic: cardsFor() would stop returning the card, so the orchestrator
    // could never call applyVisibility(card, false) on it and turning the
    // filter back off would leave it hidden forever. It also vanished from
    // the summary's own count of what it had hidden.
    if (card.classList && (card.classList.contains('ljc-hidden') || card.classList.contains('ljc-hiding'))) {
      return true;
    }

    const rect = card.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function indeedFindCards() {
    return unique(
      Array.from(document.querySelectorAll(INDEED_TITLE_SELECTOR)).map(indeedCardFromTitle)
    ).filter(isVisibleIndeedCard);
  }

  function indeedExtractJobId(card) {
    const title = card.matches && card.matches('[data-jk]')
      ? card
      : card.querySelector && card.querySelector(INDEED_TITLE_SELECTOR);
    return title ? title.getAttribute('data-jk') : null;
  }

  function indeedCardsFor(jobId) {
    const id = escape(jobId);
    const titles = document.querySelectorAll(
      `a.jcs-JobTitle[data-jk="${id}"], a[data-jk="${id}"][aria-label^="full details of "]`
    );
    return unique(Array.from(titles).map(indeedCardFromTitle)).filter(isVisibleIndeedCard);
  }

  function indeedPlatformLabelForCard(card) {
    const locationEl = card.querySelector('[data-testid="text-location"]');
    const value = locationEl ? (locationEl.textContent || '').trim() : '';
    if (/^remote$/i.test(value)) return 'REMOTE';
    if (/^hybrid$/i.test(value)) return 'HYBRID';
    if (/^on[- ]?site$/i.test(value)) return 'ON_SITE';
    return null;
  }

  function indeedCurrentJobId(doc) {
    try {
      const fromUrl = new URL(doc.location.href).searchParams.get('vjk');
      if (fromUrl) return fromUrl;
    } catch (e) {
      // Fall through to the selected-card signal.
    }

    const selected = doc.querySelector(
      'a.jcs-JobTitle[data-jk][aria-pressed="true"], a[data-jk][aria-pressed="true"]'
    );
    return selected ? selected.getAttribute('data-jk') : null;
  }

  function indeedDescriptionFromCurrentDocument(doc, jobId) {
    if (indeedCurrentJobId(doc) !== String(jobId)) return null;
    const el = doc.getElementById('jobDescriptionText');
    return el && el.innerText ? el.innerText.trim() : null;
  }

  function indeedSummaryPlacement(firstCard) {
    const listItem = firstCard.closest('li');
    const anchor = listItem || firstCard;
    return { parent: anchor.parentElement, anchor };
  }

  const indeed = {
    id: 'indeed',
    platformName: 'Indeed',
    extractJobId: indeedExtractJobId,
    findJobCardElements: indeedFindCards,
    findConsentAnchorElements: indeedFindCards,
    cardsFor: indeedCardsFor,
    platformLabelForCard: indeedPlatformLabelForCard,
    summaryPlacement: indeedSummaryPlacement,
    cacheJobId(jobId) {
      return `indeed_${jobId}`;
    },
    jobUrl(jobId) {
      // Standalone /viewjob URLs are increasingly challenged by Indeed's
      // "Additional Verification Required" page when several descriptions
      // are loaded in succession. The current search URL with a different
      // `vjk` renders the same full description in Indeed's own split-view
      // panel and remains available to the authenticated page session.
      const url = new URL(location.href);
      url.hash = '';
      url.searchParams.delete('jk');
      url.searchParams.set('vjk', String(jobId));
      return url.href;
    },
    descriptionFromCurrentDocument: indeedDescriptionFromCurrentDocument,
    descriptionFromDocument(doc) {
      const el = doc.getElementById('jobDescriptionText');
      return el && el.innerText ? el.innerText.trim() : null;
    },
    pageIsUnavailable(bodyText) {
      return /job has expired|job is no longer available|page not found|did not match any jobs/i.test(bodyText);
    },
  };

  if (host === 'www.linkedin.com') {
    global.RemoteSite = linkedin;
  } else if (host === 'indeed.com' || host.endsWith('.indeed.com')) {
    global.RemoteSite = indeed;
  }
})(window);
