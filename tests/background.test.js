const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'background.js'), 'utf8');
let messageListener;
let outgoingRequest;

const storage = {};

const sandbox = {
  self: {
    RemoteClassifierConfig: {
      workerUrl: 'https://remote-checker.example.workers.dev/v1/classify',
    },
  },
  importScripts() {},
  crypto,
  chrome: {
    runtime: {
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
    },
    storage: {
      local: {
        async get(key) {
          return key in storage ? { [key]: storage[key] } : {};
        },
        async set(items) {
          Object.assign(storage, items);
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
  // The network boundary must fail closed before consent. In particular, the
  // random install ID must not even be created while remote checks are off.
  const beforeConsent = await send({
    type: 'LJC_CLASSIFY_LLM',
    description: 'This is a fully remote role with no office requirement.',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(beforeConsent)), {
    ok: false,
    error: 'Remote checking has not been enabled.',
  });
  assert.equal(outgoingRequest, undefined);
  assert.equal(storage.ljcInstallId, undefined);

  storage.ljcDataConsentV1 = 'granted';

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

  // The Worker meters per installation, so the id has to be sent, has to be
  // a UUID the Worker will accept, and has to be persisted rather than
  // regenerated per request — a rotating id would defeat the quota.
  const sentId = outgoingRequest.options.headers['X-Install-Id'];
  assert.match(sentId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.equal(storage.ljcInstallId, sentId);
  assert.ok(
    !Object.keys(storage).some((key) => key.startsWith('ljc_')),
    'the install id must sit outside the ljc_ cache namespace RemoteCache sweeps'
  );

  await send({ type: 'LJC_CLASSIFY_LLM', description: 'Another fully remote role, no office.' });
  assert.equal(outgoingRequest.options.headers['X-Install-Id'], sentId);

  // The service worker caps the description independently of the content
  // script, so a caller that bypasses classifier.js still can't send an
  // oversized body the Worker would only reject with a 413.
  const huge = 'Fully remote. '.repeat(2000);
  assert.ok(huge.length > 8000);
  await send({ type: 'LJC_CLASSIFY_LLM', description: huge });
  assert.equal(JSON.parse(outgoingRequest.options.body).description.length, 8000);

  console.log('Background proxy tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
