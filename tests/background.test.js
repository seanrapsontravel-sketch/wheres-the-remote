const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'background.js'), 'utf8');
let messageListener;
let outgoingRequest;

const sandbox = {
  self: {
    RemoteClassifierConfig: {
      workerUrl: 'https://remote-checker.example.workers.dev/v1/classify',
    },
  },
  importScripts() {},
  chrome: {
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
    },
  },
  fetch: async (url, options) => {
    outgoingRequest = { url, options };
    return new Response(
      JSON.stringify({
        category: 'TRUE_REMOTE',
        reason: 'The role is fully remote.',
        cadence: null,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  },
  AbortController,
  Response,
  URL,
  clearTimeout,
  setTimeout,
};

vm.createContext(sandbox);
vm.runInContext(source, sandbox);

assert.equal(typeof messageListener, 'function');

function send(message) {
  return new Promise((resolve) => {
    const asynchronous = messageListener(message, {}, resolve);
    assert.equal(asynchronous, true);
  });
}

(async () => {
  const result = await send({
    type: 'LJC_CLASSIFY_LLM',
    description: 'This is a fully remote role with no office requirement.',
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    ok: true,
    result: {
      category: 'TRUE_REMOTE',
      reason: 'The role is fully remote.',
    },
  });
  assert.equal(
    outgoingRequest.url,
    'https://remote-checker.example.workers.dev/v1/classify'
  );
  assert.equal(outgoingRequest.options.headers.Authorization, undefined);
  assert.equal(
    JSON.parse(outgoingRequest.options.body).description,
    'This is a fully remote role with no office requirement.'
  );

  console.log('Background proxy tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
