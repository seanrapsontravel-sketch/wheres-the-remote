const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const sent = [];

const sandbox = {
  window: {},
  chrome: {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        sent.push(message);
        callback({
          ok: true,
          result: { category: 'TRUE_REMOTE', reason: 'Fully remote.', cadence: null },
        });
      },
    },
  },
};

vm.createContext(sandbox);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'classifier.js'), 'utf8'),
  sandbox
);

const { classify, classifyWithFallback } = sandbox.window.RemoteClassifier;

(async () => {
  // A job board can render an arbitrarily large "description" — the content
  // script must not serialize megabytes across the extension message boundary
  // only for background.js to cut it to 8000 characters on the other side.
  const huge = 'Fully remote work from anywhere. '.repeat(5000);
  assert.ok(huge.length > 8000);

  await classifyWithFallback(huge);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'LJC_CLASSIFY_LLM');
  assert.equal(sent[0].description.length, 8000);

  // Shorter descriptions must still cross intact.
  const normal = 'This is a fully remote role with no office requirement.';
  await classifyWithFallback(normal);
  assert.equal(sent.at(-1).description, normal);

  // The local rules stay the fallback when the LLM path fails.
  sandbox.chrome.runtime.sendMessage = (message, callback) => {
    sandbox.chrome.runtime.lastError = { message: 'Service worker unavailable.' };
    callback(undefined);
    sandbox.chrome.runtime.lastError = null;
  };
  const fallback = await classifyWithFallback(normal);
  assert.deepEqual(fallback, classify(normal));
  assert.equal(fallback.category, 'TRUE_REMOTE');

  console.log('Classifier tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
