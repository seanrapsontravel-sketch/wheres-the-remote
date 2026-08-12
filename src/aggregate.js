/**
 * Pure aggregation helpers for the current job-board results.
 *
 * Keeping the maths independent from the DOM makes the headline insight
 * deterministic and easy to regression-test as the LinkedIn integration
 * changes around it.
 */
(function (global) {
  const OFFICE_REQUIRED_CATEGORIES = new Set(['HYBRID', 'NOT_REMOTE']);

  function platformLabelFromText(value) {
    const text = String(value || '').replace(/\u2011|\u2013|\u2014/g, '-');
    const parenthetical = text.match(/\((remote|hybrid|on[- ]?site)\)/i);
    const standalone = text
      .split(/\n+/)
      .map((line) => line.trim())
      .find((line) => /^(remote|hybrid|on[- ]?site)$/i.test(line));
    const match = parenthetical ? parenthetical[1] : standalone;

    if (!match) return null;
    if (/^remote$/i.test(match)) return 'REMOTE';
    if (/^hybrid$/i.test(match)) return 'HYBRID';
    return 'ON_SITE';
  }

  function summarize(entries) {
    const summary = {
      totalCards: 0,
      checked: 0,
      pending: 0,
      errors: 0,
      trueRemote: 0,
      remoteTravel: 0,
      officeRequired: 0,
      notStated: 0,
      remoteLabelled: 0,
      remoteLabelledChecked: 0,
      remoteLabelledOfficeRequired: 0,
      remoteLabelledOfficeRate: null,
    };

    for (const entry of entries || []) {
      summary.totalCards++;
      const state = entry && entry.state;
      const isRemoteLabelled = entry && entry.platformLabel === 'REMOTE';

      if (isRemoteLabelled) summary.remoteLabelled++;

      if (!state || state.status === 'loading') {
        summary.pending++;
        continue;
      }
      if (state.status === 'error') {
        summary.errors++;
        continue;
      }
      if (state.status !== 'done') {
        summary.pending++;
        continue;
      }

      summary.checked++;
      if (isRemoteLabelled) summary.remoteLabelledChecked++;

      if (state.category === 'TRUE_REMOTE') summary.trueRemote++;
      else if (state.category === 'REMOTE_TRAVEL') summary.remoteTravel++;
      else if (OFFICE_REQUIRED_CATEGORIES.has(state.category)) summary.officeRequired++;
      else summary.notStated++;

      if (isRemoteLabelled && OFFICE_REQUIRED_CATEGORIES.has(state.category)) {
        summary.remoteLabelledOfficeRequired++;
      }
    }

    if (summary.remoteLabelledChecked > 0) {
      summary.remoteLabelledOfficeRate = Math.round(
        (summary.remoteLabelledOfficeRequired / summary.remoteLabelledChecked) * 100
      );
    }

    return summary;
  }

  function remoteInsight(summary, platformName) {
    const platform = platformName || 'LinkedIn';
    if (!summary || summary.remoteLabelled === 0) {
      return `No ${platform}-labelled Remote jobs are loaded in these results.`;
    }

    if (summary.remoteLabelledChecked === 0) {
      return `${summary.remoteLabelled} ${platform}-labelled Remote ${
        summary.remoteLabelled === 1 ? 'job is' : 'jobs are'
      } waiting to be checked.`;
    }

    const checkedNoun = summary.remoteLabelledChecked === 1 ? 'job' : 'jobs';
    const pending = summary.remoteLabelled - summary.remoteLabelledChecked;
    const pendingText = pending > 0 ? ` ${pending} still checking.` : '';
    return `${summary.remoteLabelledOfficeRequired} of ${summary.remoteLabelledChecked} checked ${platform} “Remote” ${checkedNoun} require regular office attendance (${summary.remoteLabelledOfficeRate}%).${pendingText}`;
  }

  global.RemoteAggregate = { platformLabelFromText, summarize, remoteInsight };
})(window);
