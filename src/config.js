/**
 * Public extension configuration. This file contains no secrets and is safe
 * to include in the Chrome Web Store package.
 *
 * This URL is public configuration; the OpenAI key remains a Cloudflare
 * secret and is never included in the extension.
 */
self.RemoteClassifierConfig = Object.freeze({
  workerUrl:
    'https://linkedin-remote-checker-proxy.wherestheremote.workers.dev/v1/classify',
});
