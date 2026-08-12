# Where's the remote?

The Chrome extension classifies job descriptions with an OpenAI-backed
Cloudflare Worker. The OpenAI API key is stored only in Cloudflare and is not
included in the extension.

## Deploy the classification Worker

1. In the OpenAI dashboard, create a dedicated project and API key for this
   extension. Set the project's **hard** monthly limit — the one that stops
   requests — to the maximum amount you are comfortable spending, and a lower
   soft limit to be notified before you reach it. A soft/notification
   threshold on its own does not stop anything; requests keep being served
   after it is crossed. Do not treat OpenAI's budget as the only thing between
   an abused endpoint and the bill.
2. From the `worker` directory, install the Worker tooling:

   ```sh
   npm install
   ```

3. Sign in to Cloudflare:

   ```sh
   npx wrangler login
   ```

4. Store the OpenAI key as a Cloudflare secret. Do not put it in a source file:

   ```sh
   npx wrangler secret put OPENAI_API_KEY
   ```

5. Deploy the Worker:

   ```sh
   npm run deploy
   ```

6. The deployed Worker URL is configured in `src/config.js` as
   `https://linkedin-remote-checker-proxy.wherestheremote.workers.dev/v1/classify`.
   This URL is public configuration, not a secret.
7. Reload the unpacked extension in Chrome and test a LinkedIn or Indeed job.

For local Worker development, put `OPENAI_API_KEY=...` in `worker/.dev.vars`.
That file is ignored by Git. Never add the key to `src`, `manifest.json`, a
request header in the extension, or a committed configuration file.

## Tests

Run the extension tests from the repository root:

```sh
for f in tests/*.test.js; do node "$f" || break; done
```

Run the Worker tests from the `worker` directory:

```sh
npm test
```

## Abuse and spend

The Worker is anonymous. Its URL ships inside the extension, so anyone who
finds it can send requests to it; they cannot obtain the OpenAI key, but they
can spend it. Nothing here is authentication — the extension holds no
credential a determined caller couldn't extract, and the install id it sends
is a self-asserted metering key, not proof of anything. What follows bounds
the damage rather than keeping anyone out.

Three rate-limit bindings, in the order `worker/src/index.js` checks them:

| Binding | Key | Limit | Role |
| --- | --- | --- | --- |
| `INSTALL_RATE_LIMITER` | `X-Install-Id`, or the IP without one | 300/min | Survives the IP rotation that defeats per-IP metering |
| `CLASSIFY_RATE_LIMITER` | client IP | 600/min | Backstop against forged install ids; loose, because IPs are shared |
| `GLOBAL_RATE_LIMITER` | one shared key | 1200/min | Burst ceiling, checked immediately before the OpenAI call |

That order is deliberate. The two per-caller limiters run first and meter
*everything*, malformed bodies included — a client flooding junk is abusive
whether or not its JSON parses. The global breaker runs last, after validation
and immediately before the only call that costs money, so traffic that will
never reach OpenAI cannot exhaust the ceiling real users need. An earlier
version checked the breaker first, which meant a stream of unparseable bodies
could silently downgrade every user to the local regex classifier at no cost
to the attacker.

**These are sized above real usage on purpose.** A throttled user sees no
error: the 429 becomes a thrown error in `background.js`, and
`classifyWithFallback` silently drops to the local regex classifier, which is
less accurate and — with the hide toggle on — can hide a genuinely remote
job. Degrading someone's results to save a fraction of a cent is a bad trade,
so every limit clears realistic peak human load with room to spare.

The reference figure: a LinkedIn search page is 25 results fetched 4 at a
time (~7 waves). Extraction is fast in practice — roughly a second, and
instant on Indeed's split view, which reads the description from the page
it's already on instead of opening an iframe — so a page completes in ~7s and
a user paging without pause peaks near 214 req/min. That is the physical
ceiling: pages can't be consumed faster than they load. Every limit clears it.

Note the direction of that: making extraction *faster* raises peak req/min,
because more pages fit in a minute. Re-derive these numbers before lowering
any limit, and again if extraction speed changes.

A missing binding fails closed, so a deploy that drops one returns errors
instead of quietly becoming unmetered.

### None of this caps your bill

A per-minute limiter bounds a *spike*, not a *total*. Sustained 600/min is
~860k requests/day. Cloudflare's rate-limit bindings only support 10s or 60s
periods, so they cannot express "N per day" — and Cloudflare's limiter is
per-location and eventually consistent besides, making it a throttle rather
than an accounting system. Real throughput can exceed the configured number.

The actual spend cap has to be a daily counter in KV or a Durable Object,
checked before the OpenAI call and set generously enough that only abuse
reaches it. **This is not built yet.** Until it is, the things standing
between an abused endpoint and the invoice are OpenAI's *hard* project limit
and the alerts below — so set both.

A shared server-side cache, keyed on a hash of the description, would also
cut OpenAI calls sharply: many users see the same postings, and today every
install classifies each one independently.

Rate-limit bindings emit no dashboard metrics, so the Worker logs its own.
With `[observability]` enabled, `event=classified` carries per-request token
counts and `event=global_limit_tripped` marks the breaker firing. **Set up
alerts on both before launch** — a sustained rise in the first, and any
occurrence of the second. Neither log line contains description text,
classification results, or any identifier.

Cloudflare's own invocation logging is a separate thing from those two lines
and is not under the Worker's control: it records request metadata and can
include headers, so the raw `X-Install-Id` may appear in Workers Logs even
though `src/index.js` never writes it. `docs/privacy.html` discloses this.
Sampling stays at 1 on purpose — the token counts are the only cost signal
there is, and sampling below 1 would undercount the number the alerts watch.

Optionally set `SAFETY_ID_SALT` as a second Cloudflare secret. It salts the
hash sent to OpenAI as `safety_identifier`, so an unsalted digest of a v4 UUID
can't be reversed by brute-forcing candidate ids.
