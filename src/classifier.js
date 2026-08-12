/**
 * Deterministic, rule-based classifier for "is this job actually remote?".
 *
 * Exposes window.RemoteClassifier.classify(descriptionText) -> {
 *   category: 'TRUE_REMOTE' | 'REMOTE_TRAVEL' | 'HYBRID' | 'NOT_REMOTE' | 'UNCLEAR',
 *   reason: string | null
 * }
 *
 * Rules are checked in priority order and the first match wins, because an
 * explicit permanent-onsite requirement should always outrank marketing
 * language like "remote-first" appearing earlier in the same posting.
 *
 * This is intentionally local/deterministic for v1. To add an LLM fallback
 * for genuinely ambiguous postings later, call classifyWithFallback() (see
 * bottom of file) instead of classify() directly — it already has the hook.
 */
(function (global) {
  function splitSentences(text) {
    return text
      .replace(/\s+/g, ' ')
      .split(/(?<=[.?!])\s+(?=[A-Z0-9])/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function trimReason(str, max) {
    max = max || 140;
    const clean = str.replace(/\s+/g, ' ').trim();
    return clean.length > max ? clean.slice(0, max - 1).trim() + '…' : clean;
  }

  // --- Cue patterns -------------------------------------------------------

  const TEMP_REMOTE_CUE = /\b(initial(ly)?|onboarding|probation(ary)?|training period|first\s+\d+\s*(days?|weeks?|months?)|ramp[- ]?up|induction period|during (the )?onboarding)\b/i;

  const TRANSITION_CUE = /\b(once|after|following|then|upon|subsequently|thereafter|before transitioning)\b/i;

  const FUTURE_OBLIGATION_CUE = /\b(will be (expected|required)|must (then )?(work|attend|relocate|be based)|you('ll| will) (need|be expected) to|expected to work|required to work)\b/i;

  const ONSITE_CUE = /\b(onsite|on-site|in[- ]office|in the office|office[- ]based|attend the office|based in (the )?office|relocat(e|ion|ing)|work from (our|the) office)\b/i;

  const EXPLICIT_NOT_REMOTE = [
    /\bnot a remote (role|position|job)\b/i,
    /\bno remote work\b/i,
    /\bno(t)? (fully )?remote\b/i,
    /\b(5|five) days?\s*(a|per)\s*week\s*(in|at|from)\s*(the\s*)?office\b/i,
    /\boffice\b[^.]{0,40}\b(5|five) days?\s*(a|per)\s*week\b/i,
    /\bfull[- ]time (onsite|on-site|in[- ]?office)\b/i,
    /\boffice[- ]based (role|position)\b/i,
    /\brequired to work (from|in|at) the office (full[- ]?time)?\b/i,
    /\bthis is an? (onsite|on-site|in[- ]office) (role|position|job)\b/i,
    // "must be based in the UK/EU/etc." on its own is a country-eligibility
    // clause (tax/legal residency), not an onsite requirement — extremely
    // common in genuinely remote postings, so it must NOT trigger this on
    // its own. Only "willing to relocate" is unambiguous about physically
    // moving somewhere for the job.
    /\bmust be willing to relocate (in|at|near|to)\b/i,
  ];

  // A stated office cadence of monthly-or-less reads as "remote with
  // occasional travel" even when the posting also uses the word "hybrid" —
  // e.g. "Hybrid - London (1 day per month)" is much closer to remote than
  // to a real weekly hybrid split, so this is checked before HYBRID_CUES.
  const LOW_FREQUENCY_OFFICE_CUES = [
    /\b\d+\s*days?\s*(a|per)\s*(month|quarter)\b/i,
    /\bonce\s*(a|per|every)\s*(month|quarter)\b/i,
    /\bmonthly\s*(office|onsite|on-site|in-person|visit|attendance|meet-?up)/i,
    /\bquarterly\s*(office|onsite|on-site|in-person|visit|attendance|meet-?up)?/i,
  ];

  const HYBRID_CUES = [
    /\bhybrid\b/i,
    /\b(\d+)\s*days?\s*(a|per)\s*week\b[^.]{0,60}\b(office|onsite|on-site)\b/i,
    /\b(office|onsite|on-site)\b[^.]{0,60}\b(\d+)\s*days?\s*(a|per)\s*week\b/i,
    /\bsplit (your time|between)[^.]{0,40}(home|remote)[^.]{0,40}office\b/i,
    /\bpart[- ]remote\b/i,
    /\bmix(ture)? of (remote|home)[^.]{0,30}office\b/i,
  ];

  const OCCASIONAL_TRAVEL_CUES = [
    /\boccasional(ly)?\s+(travel|visits?|in[- ]person|on-?site|office)\b/i,
    /\b(quarterly|a few times a year|periodic(ally)?|from time to time)\s+(travel|visits?|meet(ing)?s?|on-?site)\b/i,
    /\bcompany (meetups?|off-?sites?|retreats?)\b/i,
    /\btravel (to the office )?(as needed|occasionally|infrequently)\b/i,
    /\bminimal (travel|office attendance)\b/i,
  ];

  const TRUE_REMOTE_CUES = [
    /\b(fully|100%|completely|truly) remote\b/i,
    /\bremote[- ]first\b/i,
    /\bwork from (home|anywhere)\b/i,
    /\bremote position\b/i,
    /\bno office (requirement|attendance)\b/i,
    /\bremote[- ]only\b/i,
    /\banywhere in the (uk|united kingdom|country|world)\b/i,
    // A company's own description of its established working model is
    // strong evidence when paired with broad, office-agnostic geographic
    // hiring — not just marketing language — e.g. "candidates can be based
    // in the UK or the EU ... a native remote-working culture".
    /\b(native(ly)?|established) remote[- ]?(working)? culture\b/i,
    /\bremote[- ]?working culture\b/i,
    /\bfully distributed( team)?\b/i,
    /\bdistributed team\b/i,
    /\bcan be (based|located) (in|across|anywhere)\b[^.]{0,80}\bremote\b/i,
  ];

  const ANY_REMOTE_MENTION = /\bremote\b/i;

  // --- Rule engine ---------------------------------------------------------

  function findTransitionalNotRemote(text) {
    const sentences = splitSentences(text);
    for (let i = 0; i < sentences.length; i++) {
      if (!TEMP_REMOTE_CUE.test(sentences[i])) continue;
      // Look at this sentence and the next couple for an onsite obligation.
      const window = sentences.slice(i, i + 3).join(' ');
      if (!ONSITE_CUE.test(window)) continue;
      if (TRANSITION_CUE.test(window) || FUTURE_OBLIGATION_CUE.test(window)) {
        const onsiteSentence = sentences.slice(i, i + 3).find((s) => ONSITE_CUE.test(s)) || window;
        return trimReason(onsiteSentence);
      }
    }
    return null;
  }

  function findFirstMatch(patterns, text) {
    for (const re of patterns) {
      const m = text.match(re);
      if (m) return m;
    }
    return null;
  }

  function sentenceContaining(text, index) {
    const sentences = splitSentences(text);
    let pos = 0;
    for (const s of sentences) {
      const start = text.indexOf(s, pos);
      if (index >= start && index <= start + s.length) return s;
      pos = start + s.length;
    }
    return text.slice(Math.max(0, index - 60), index + 80);
  }

  function classify(descriptionText) {
    // Normalize whitespace once, up front, and use this exact string for
    // every regex match and index lookup below. sentenceContaining() relies
    // on indices lining up with a whitespace-normalized string (that's what
    // splitSentences() produces internally) — matching against raw text
    // with real newlines/runs of spaces here caused indexOf() to fail and
    // fall through to a crude char-offset slice that cut words in half.
    const text = (descriptionText || '').replace(/\s+/g, ' ').trim();

    if (text.length < 40) {
      return { category: 'UNCLEAR', reason: 'No usable job description text was found.' };
    }

    // 1. Temporary remote that transitions to a permanent onsite requirement.
    const transitional = findTransitionalNotRemote(text);
    if (transitional) {
      return { category: 'NOT_REMOTE', reason: transitional };
    }

    // 2. Explicit permanent onsite / "not remote" requirement.
    const notRemoteMatch = findFirstMatch(EXPLICIT_NOT_REMOTE, text);
    if (notRemoteMatch) {
      return { category: 'NOT_REMOTE', reason: trimReason(sentenceContaining(text, notRemoteMatch.index)) };
    }

    // 3. Office attendance stated as monthly-or-less — closer to occasional
    // travel than a real hybrid split, regardless of the word "hybrid".
    const lowFreqMatch = findFirstMatch(LOW_FREQUENCY_OFFICE_CUES, text);
    if (lowFreqMatch) {
      return {
        category: 'REMOTE_TRAVEL',
        reason: trimReason(sentenceContaining(text, lowFreqMatch.index)),
        cadence: lowFreqMatch[0].trim(),
      };
    }

    // 4. Hybrid working pattern.
    const hybridMatch = findFirstMatch(HYBRID_CUES, text);
    if (hybridMatch) {
      return { category: 'HYBRID', reason: trimReason(sentenceContaining(text, hybridMatch.index)) };
    }

    // 5. Remote with occasional in-person travel/meetings.
    const travelMatch = findFirstMatch(OCCASIONAL_TRAVEL_CUES, text);
    if (travelMatch && ANY_REMOTE_MENTION.test(text)) {
      return { category: 'REMOTE_TRAVEL', reason: trimReason(sentenceContaining(text, travelMatch.index)) };
    }

    // 6. Clear fully-remote language with nothing contradicting it above.
    const trueRemoteMatch = findFirstMatch(TRUE_REMOTE_CUES, text);
    if (trueRemoteMatch) {
      return { category: 'TRUE_REMOTE', reason: trimReason(sentenceContaining(text, trueRemoteMatch.index)) };
    }

    // 7. Weak/no signal.
    if (ANY_REMOTE_MENTION.test(text)) {
      const m = text.match(ANY_REMOTE_MENTION);
      return { category: 'UNCLEAR', reason: trimReason(sentenceContaining(text, m.index)) };
    }

    return { category: 'UNCLEAR', reason: 'Description did not mention remote or office working arrangements clearly.' };
  }

  function requestLLMClassification(descriptionText) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'LJC_CLASSIFY_LLM', description: descriptionText }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || !response.ok) {
          reject(new Error((response && response.error) || 'LLM classification failed.'));
          return;
        }
        resolve(response.result);
      });
    });
  }

  /**
   * The local regex rules are cheap but pattern-match on bare keywords (e.g.
   * "quarterly") with no understanding of context, so they misfire on text
   * like "quarterly feature delivery" that has nothing to do with office
   * attendance. The LLM actually reads the sentence, so it's the primary
   * classifier now. The local rules only run as a fallback when the LLM call
   * itself fails — no API key configured, network error, timeout — so the
   * extension still produces *something* offline instead of erroring out.
   */
  async function classifyWithFallback(descriptionText) {
    try {
      const llmResult = await requestLLMClassification(descriptionText);
      return { category: llmResult.category, reason: llmResult.reason, cadence: llmResult.cadence };
    } catch (err) {
      return classify(descriptionText);
    }
  }

  global.RemoteClassifier = { classify, classifyWithFallback };
})(window);
