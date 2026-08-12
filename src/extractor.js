/**
 * Fetches the real job description for a supported job-board job ID.
 *
 * Why this approach: LinkedIn's /jobs/view/{id}/ page does NOT contain the
 * description in the initial server HTML — it's fetched by LinkedIn's own
 * client-side app after mount, via an internal GraphQL call that requires a
 * CSRF token pairing that isn't reliably reproducible from a content script.
 * Calling that private API directly returned "CSRF check failed" in testing.
 *
 * Instead, we load the real job page in a hidden same-origin iframe (so it
 * runs the job board's own authenticated app code, cookies and all) and read
 * the description straight out of the rendered DOM once it is populated.
 * LinkedIn's description container id is templated with the job id
 * (`JobDetails_AboutTheJob_{jobId}`), which held steady across every job
 * tested and gives a reliable selector despite LinkedIn's CSS classes being
 * build-hashed and unstable.
 *
 * One quirk verified empirically: LinkedIn lazy-loads that section based on
 * viewport intersection *inside the iframe's own document*. An iframe that's
 * offscreen (e.g. `left: -9999px`) or too short never triggers the fetch. So
 * the iframe must be sized like a real viewport and positioned on-screen —
 * it's kept invisible via opacity:0 + pointer-events:none instead.
 */
(function (global) {
  const IFRAME_WIDTH = 1400;
  const IFRAME_HEIGHT = 3000;
  const DEFAULT_TIMEOUT_MS = 16000;
  const POLL_INTERVAL_MS = 350;

  // Some boards' "job URL" is the same listing page the extension is already
  // scanning (e.g. Indeed's split view — see jobUrl() in site.js), so this
  // iframe's contentDocument can itself contain job cards matching our own
  // content_scripts pattern (all_frames: true, whole-domain match). Without
  // a marker, Chrome would inject the full checker into the iframe too, and
  // it would recursively spawn further extraction iframes for those cards —
  // this froze a real Indeed search tab in testing. window.name survives
  // navigation within a frame, so content.js's entry guard can check it
  // before doing anything else. Keep this value in sync with content.js.
  const EXTRACTOR_FRAME_NAME = 'LJC_EXTRACTOR_FRAME';

  function createHiddenIframe(jobId) {
    const iframe = document.createElement('iframe');
    iframe.name = EXTRACTOR_FRAME_NAME;
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    Object.assign(iframe.style, {
      width: IFRAME_WIDTH + 'px',
      height: IFRAME_HEIGHT + 'px',
      position: 'fixed',
      top: '0px',
      left: '0px',
      border: '0',
      opacity: '0',
      pointerEvents: 'none',
      zIndex: '-1',
    });
    iframe.src = RemoteSite.jobUrl(jobId);
    iframe.dataset.ljcJobId = String(jobId);
    return iframe;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Resolves with the description text, or null if it couldn't be found
   * (page failed to load, job removed/expired, or timed out).
   */
  async function fetchDescription(jobId, opts) {
    // Indeed's split-view search pages already contain the selected job's
    // complete description. Use it immediately when it belongs to this job,
    // avoiding both an extra page load and Indeed's standalone-page challenge.
    if (RemoteSite.descriptionFromCurrentDocument) {
      const inline = RemoteSite.descriptionFromCurrentDocument(document, jobId);
      if (inline) return inline;
    }

    const timeoutMs = (opts && opts.timeoutMs) || DEFAULT_TIMEOUT_MS;
    const iframe = createHiddenIframe(jobId);
    document.body.appendChild(iframe);

    const deadline = Date.now() + timeoutMs;
    try {
      while (Date.now() < deadline) {
        let doc = null;
        try {
          doc = iframe.contentDocument;
        } catch (e) {
          // The adapter always uses the current board's origin, but guard in
          // case a posting redirects to an external employer site.
          return null;
        }

        if (doc && doc.readyState !== 'loading') {
          const description = RemoteSite.descriptionFromDocument(doc, jobId);
          if (description) return description;

          // Job posting may be unavailable/expired; each adapter recognises
          // that board's explicit unavailable/not-found wording.
          const bodyText = doc.body ? doc.body.innerText : '';
          if (RemoteSite.pageIsUnavailable(bodyText)) {
            return null;
          }
        }

        await sleep(POLL_INTERVAL_MS);
      }
      return null; // timed out
    } finally {
      iframe.remove();
    }
  }

  global.RemoteExtractor = { fetchDescription };
})(window);
