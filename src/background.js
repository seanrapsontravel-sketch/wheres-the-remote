/**
 * Background service worker.
 *
 * The extension never receives the OpenAI API key. It sends job descriptions
 * to our Cloudflare Worker, which owns the prompt, model configuration and
 * OpenAI credential. The local rule-based classifier remains available when
 * this request fails.
 */
importScripts('recovery.js');
importScripts('config.js');

const ALLOWED_CATEGORIES = ['TRUE_REMOTE', 'REMOTE_TRAVEL', 'HYBRID', 'NOT_REMOTE', 'UNCLEAR'];
const REQUEST_TIMEOUT_MS = 20000;
const MAX_DESCRIPTION_CHARS = 8000;
const INSTALL_ID_KEY = 'ljcInstallId';
const INSTALL_ID_HEADER = 'X-Install-Id';

/**
 * A random per-installation identifier, so the Worker can meter usage per
 * install rather than per IP — IPs are shared behind NAT and trivially
 * rotated by anyone abusing the endpoint.
 *
 * This is a v4 UUID generated on the device and never linked to an account,
 * profile or anything the user typed. It is not a credential: it identifies
 * a bucket, not a permission, and the endpoint stays anonymous.
 *
 * Deliberately NOT prefixed `ljc_` — RemoteCache.purgeExpired() sweeps that
 * namespace in chrome.storage.local.
 */
let installIdPromise = null;

function installId() {
  if (installIdPromise) return installIdPromise;

  installIdPromise = (async () => {
    const stored = await chrome.storage.local.get(INSTALL_ID_KEY);
    const existing = stored[INSTALL_ID_KEY];
    if (typeof existing === 'string' && existing) return existing;

    const created = crypto.randomUUID();
    await chrome.storage.local.set({ [INSTALL_ID_KEY]: created });
    return created;
  })().catch(() => {
    // Storage can fail (quota, a profile in an odd state). Classification is
    // the user-visible feature and must not break over a metering key, so
    // fall back to an id that lives as long as this service worker does.
    installIdPromise = null;
    return crypto.randomUUID();
  });

  return installIdPromise;
}

function workerEndpoint() {
  const configured = self.RemoteClassifierConfig && self.RemoteClassifierConfig.workerUrl;
  if (!configured || configured.includes('YOUR_WORKERS_SUBDOMAIN')) {
    throw new Error('The classification service has not been configured.');
  }

  let url;
  try {
    url = new URL(configured);
  } catch (error) {
    throw new Error('The classification service URL is invalid.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('The classification service must use HTTPS.');
  }

  return url.toString();
}

function withTimeout(request, ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return request(controller.signal).finally(() => clearTimeout(timeout));
}

async function classifyWithLLM(description) {
  const truncated = String(description || '').slice(0, MAX_DESCRIPTION_CHARS);
  if (!truncated.trim()) throw new Error('No job description was supplied.');

  const endpoint = workerEndpoint();
  const id = await installId();

  const response = await withTimeout(
    (signal) =>
      fetch(endpoint, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          [INSTALL_ID_HEADER]: id,
        },
        body: JSON.stringify({ description: truncated }),
      }),
    REQUEST_TIMEOUT_MS
  );

  if (!response.ok) {
    let message = 'Classification service unavailable.';
    try {
      const body = await response.json();
      if (body && typeof body.error === 'string') message = body.error;
    } catch (error) {
      // The Worker normally returns JSON. Keep a safe generic message if an
      // intermediary returns HTML or another unexpected response.
    }
    throw new Error(message);
  }

  const result = await response.json();
  if (!result || !ALLOWED_CATEGORIES.includes(result.category)) {
    throw new Error('The classification service returned an invalid result.');
  }

  return {
    category: result.category,
    reason: String(result.reason || '').slice(0, 160),
    cadence: result.cadence ? String(result.cadence).slice(0, 60) : undefined,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'LJC_CLASSIFY_LLM') return false;

  classifyWithLLM(message.description)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: String(error && error.message ? error.message : error),
      })
    );

  return true;
});
