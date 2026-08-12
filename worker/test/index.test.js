import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/index.js';

const endpoint = 'https://example.workers.dev/v1/classify';

function classifyRequest(body, headers = {}) {
  return new Request(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function allowingRateLimiter() {
  return { limit: async () => ({ success: true }) };
}

function baseEnv(overrides = {}) {
  return { CLASSIFY_RATE_LIMITER: allowingRateLimiter(), ...overrides };
}

test('only the classification route and POST method are accepted', async () => {
  const missing = await worker.fetch(new Request('https://example.workers.dev/'), {});
  assert.equal(missing.status, 404);

  const wrongMethod = await worker.fetch(new Request(endpoint), {});
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('Allow'), 'POST');
});

test('the server refuses requests when its OpenAI secret is absent', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await worker.fetch(classifyRequest({ description: 'A fully remote role.' }), {});
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Classification service is not configured.' });
  } finally {
    console.error = originalError;
  }
});

test('invalid and oversized descriptions are rejected before calling OpenAI', async () => {
  const env = baseEnv({ OPENAI_API_KEY: 'server-only-test-key' });

  const missing = await worker.fetch(classifyRequest({}), env);
  assert.equal(missing.status, 400);

  const oversized = await worker.fetch(
    classifyRequest({ description: 'x'.repeat(8001) }),
    env
  );
  assert.equal(oversized.status, 413);
});

test('an oversized request body is rejected even without a Content-Length header', async () => {
  const env = baseEnv({ OPENAI_API_KEY: 'server-only-test-key' });
  const oversizedBody = JSON.stringify({ description: 'x'.repeat(25000) });

  // ReadableStream bodies don't carry a Content-Length header, mirroring a
  // client that omits or spoofs it to slip past a header-only size check.
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(oversizedBody));
      controller.close();
    },
  });
  const request = new Request(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: stream,
    duplex: 'half',
  });
  assert.equal(request.headers.get('Content-Length'), null);

  const response = await worker.fetch(request, env);
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: 'Request is too large.' });
});

test('requests are rejected once the per-IP rate limit is exceeded', async () => {
  const env = baseEnv({
    OPENAI_API_KEY: 'server-only-test-key',
    CLASSIFY_RATE_LIMITER: { limit: async () => ({ success: false }) },
  });

  const response = await worker.fetch(
    classifyRequest({ description: 'A fully remote role.' }),
    env
  );
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: 'Too many requests. Please slow down.' });
});

test('the Worker adds the secret server-side and returns a validated result', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamRequest;
  globalThis.fetch = async (url, options) => {
    upstreamRequest = { url, options };
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                category: 'HYBRID',
                reason: 'Three days a week in the office.',
                cadence: '3 days a week',
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  try {
    const response = await worker.fetch(
      classifyRequest({ description: 'This role requires three days a week in the office.' }),
      baseEnv({ OPENAI_API_KEY: 'server-only-test-key', OPENAI_MODEL: 'test-model' })
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      category: 'HYBRID',
      reason: 'Three days a week in the office.',
      cadence: '3 days a week',
    });
    assert.equal(upstreamRequest.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(upstreamRequest.options.headers.Authorization, 'Bearer server-only-test-key');

    const upstreamBody = JSON.parse(upstreamRequest.options.body);
    assert.equal(upstreamBody.model, 'test-model');
    assert.equal(
      upstreamBody.messages.at(-1).content,
      'This role requires three days a week in the office.'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('OpenAI errors are replaced with a safe generic response', async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  globalThis.fetch = async () =>
    new Response('upstream details that must not be exposed', { status: 429 });
  console.error = () => {};

  try {
    const response = await worker.fetch(
      classifyRequest({ description: 'A fully remote role.' }),
      baseEnv({ OPENAI_API_KEY: 'server-only-test-key' })
    );
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      error: 'Classification service temporarily unavailable.',
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});
