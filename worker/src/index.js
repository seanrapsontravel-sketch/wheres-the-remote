/**
 * Cloudflare Worker for job-description classification.
 *
 * OPENAI_API_KEY is a Cloudflare secret and is never sent to, or bundled
 * with, the extension. This MVP endpoint is intentionally anonymous; abuse
 * is bounded by the CLASSIFY_RATE_LIMITER binding (per-IP) and the OpenAI
 * project's usage limit as a backstop.
 */

const ALLOWED_CATEGORIES = ['TRUE_REMOTE', 'REMOTE_TRAVEL', 'HYBRID', 'NOT_REMOTE', 'UNCLEAR'];
const CLASSIFY_PATH = '/v1/classify';
const MAX_DESCRIPTION_CHARS = 8000;
const MAX_REQUEST_BYTES = 20000;
const OPENAI_TIMEOUT_MS = 15000;

const SYSTEM_PROMPT = `You determine the REAL long-term working arrangement for a job, based on its description text, ignoring any marketing language or platform labels.

Classify into exactly one category:
- TRUE_REMOTE: genuinely fully remote, no regular office attendance required.
- REMOTE_TRAVEL: remote, but with genuinely occasional travel/company meetings/offsites (roughly monthly or less often).
- HYBRID: a regular mix of remote and office days (e.g. "3 days a week in the office").
- NOT_REMOTE: regular/permanent office attendance is required, including cases where remote work is only temporary (e.g. during onboarding/probation) and the role becomes office-based afterwards.
- UNCLEAR: the description genuinely does not give enough information to tell.

Explicit attendance REQUIREMENTS in the text always outweigh marketing language or a platform's own "Remote" tag. But do not dismiss every mention of a company's remote working model as mere marketing — weigh it by strength of evidence:
- Very strong (near-certain TRUE_REMOTE): "fully remote", "work from anywhere", "employees can be based anywhere in [region]", "fully distributed team", "no office requirement".
- Moderate (TRUE_REMOTE when there's no contradictory attendance requirement elsewhere, especially combined with broad/multi-location hiring eligibility): "remote-first", "remote-working culture", "distributed company", "candidates can be based in [region A] or [region B]" with no office tie.
- Weak on its own (do not classify as TRUE_REMOTE from this alone — needs a stronger cue too): "flexible working", "remote-friendly", "hybrid flexibility", "we trust people to work where they work best".

If nothing in the text states or implies a working-location model at all (no remote/hybrid/office language whatsoever), use UNCLEAR — do not guess.

The "cadence" field is specifically how often the person must physically be in an office/onsite location. A word like "quarterly", "monthly", or "annual" attached to something else entirely — a product roadmap, OKRs, performance reviews, board meetings, bonuses, a "quarterly feature delivery" cycle — is NOT an attendance cadence and must not be reported as one, even if the same posting is otherwise REMOTE_TRAVEL or HYBRID for unrelated reasons. Only fill in "cadence" when the frequency phrase is directly tied to being physically present somewhere (office, onsite, in-person, a specific city).

Respond with strict JSON only: {"category": "<ONE_OF_THE_ABOVE>", "reason": "<one short quoted or paraphrased clause from the text, under 140 characters, explaining why>", "cadence": "<if REMOTE_TRAVEL or HYBRID and a specific physical-attendance frequency is stated (e.g. '1 day per month', '3 days a week', 'quarterly onsite'), the frequency phrase verbatim; otherwise null>"}`;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function requestWithTimeout(request, ms) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return request(controller.signal).finally(() => clearTimeout(timeout));
}

async function readJsonWithSizeLimit(request, maxBytes) {
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new RequestTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const text = new TextDecoder().decode(concatChunks(chunks, total));
  return JSON.parse(text);
}

function concatChunks(chunks, total) {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

class RequestTooLargeError extends Error {}

async function handleClassify(request, env) {
  if (!env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not configured.');
    return json({ error: 'Classification service is not configured.' }, 503);
  }

  const clientIp = request.headers.get('CF-Connecting-IP') || 'unknown';
  const { success } = await env.CLASSIFY_RATE_LIMITER.limit({ key: clientIp });
  if (!success) {
    return json({ error: 'Too many requests. Please slow down.' }, 429);
  }

  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    return json({ error: 'Content-Type must be application/json.' }, 415);
  }

  let body;
  try {
    body = await readJsonWithSizeLimit(request, MAX_REQUEST_BYTES);
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return json({ error: 'Request is too large.' }, 413);
    }
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  if (!body || Array.isArray(body) || typeof body !== 'object') {
    return json({ error: 'JSON body must be an object.' }, 400);
  }

  if (typeof body.description !== 'string' || !body.description.trim()) {
    return json({ error: 'Missing description.' }, 400);
  }

  if (body.description.length > MAX_DESCRIPTION_CHARS) {
    return json({ error: `Description must be ${MAX_DESCRIPTION_CHARS} characters or fewer.` }, 413);
  }

  let openaiResponse;
  try {
    openaiResponse = await requestWithTimeout(
      (signal) =>
        fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: env.OPENAI_MODEL || 'gpt-5.6-luna',
            max_completion_tokens: 300,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: body.description },
            ],
          }),
        }),
      OPENAI_TIMEOUT_MS
    );
  } catch (error) {
    console.error('OpenAI request failed before receiving a response.');
    return json({ error: 'Classification service temporarily unavailable.' }, 502);
  }

  if (!openaiResponse.ok) {
    console.error(`OpenAI returned HTTP ${openaiResponse.status}.`);
    return json({ error: 'Classification service temporarily unavailable.' }, 502);
  }

  let data;
  try {
    data = await openaiResponse.json();
  } catch (error) {
    console.error('OpenAI returned invalid JSON.');
    return json({ error: 'Classification service returned an invalid result.' }, 502);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    console.error('OpenAI returned an empty classification.');
    return json({ error: 'Classification service returned an invalid result.' }, 502);
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    console.error('OpenAI classification was not valid JSON.');
    return json({ error: 'Classification service returned an invalid result.' }, 502);
  }

  if (!ALLOWED_CATEGORIES.includes(parsed.category)) {
    console.error('OpenAI classification contained an unexpected category.');
    return json({ error: 'Classification service returned an invalid result.' }, 502);
  }

  return json({
    category: parsed.category,
    reason: String(parsed.reason || '').slice(0, 160),
    cadence: parsed.cadence ? String(parsed.cadence).slice(0, 60) : null,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== CLASSIFY_PATH) {
      return json({ error: 'Not found.' }, 404);
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed.' }, 405, { Allow: 'POST' });
    }

    return handleClassify(request, env);
  },
};
