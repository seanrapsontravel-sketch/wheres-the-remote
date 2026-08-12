# Where's the remote?

The Chrome extension classifies job descriptions with an OpenAI-backed
Cloudflare Worker. The OpenAI API key is stored only in Cloudflare and is not
included in the extension.

## Deploy the classification Worker

1. In the OpenAI dashboard, create a dedicated project and API key for this
   extension. Set the project's monthly usage limit to the maximum amount you
   are comfortable spending.
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
node tests/site.test.js
node tests/aggregate.test.js
node tests/recovery.test.js
node tests/background.test.js
```

Run the Worker tests from the `worker` directory:

```sh
npm test
```

The Worker is anonymous — someone who discovers its URL can send requests to
it, but they cannot obtain the OpenAI key. A `CLASSIFY_RATE_LIMITER` binding
caps each IP at 20 requests/minute (see `worker/wrangler.toml`), so a scripted
flood is throttled well before it can run up meaningful OpenAI spend. The
OpenAI project usage limit remains a backstop on top of that.
