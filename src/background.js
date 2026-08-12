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

  const response = await withTimeout(
    (signal) =>
      fetch(workerEndpoint(), {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/json' },
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
