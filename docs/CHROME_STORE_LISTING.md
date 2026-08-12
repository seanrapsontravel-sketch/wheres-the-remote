# Chrome Web Store listing — copy to paste into the dashboard

Reference text for the Developer Dashboard's "Store listing" and "Privacy
practices" tabs. Nothing here needs to ship inside the extension package.

## Privacy policy URL

Enable GitHub Pages for this repo (Settings → Pages → Deploy from branch →
`main` → `/docs`), then use:

```
https://<your-github-username>.github.io/<repo-name>/privacy.html
```

## Single purpose description

> Where's the remote? analyzes job postings on LinkedIn and Indeed and shows
> whether a role is genuinely remote, hybrid, onsite, or requires travel,
> based on the posting's own description text rather than the platform's
> "Remote" label.

## Permission justifications

**storage**
> Caches each job listing's classification result locally
> (`chrome.storage.local`) for 14 days, keyed by job ID, so a listing already
> analyzed isn't re-sent for classification on revisits, pagination, or a
> later search. Only the classification result is stored — no personal data.

**scripting**
> Used only to re-inject the extension's own already-declared content
> scripts (`src/site.js`, `src/classifier.js`, `src/cache.js`,
> `src/extractor.js`, `src/badge.js`, `src/aggregate.js`, `src/content.js`,
> `src/badge.css`) into LinkedIn/Indeed job tabs that were already open when
> the extension is installed, updated, or the browser restarts, since Chrome
> does not automatically retrofit content scripts into existing tabs. No
> remote or dynamically generated code is ever injected — only the
> extension's own bundled files.

**host permission: `https://www.linkedin.com/*`**
> Required for the content script to run on LinkedIn job search and job
> detail pages, where it reads the visible job posting text and displays a
> remote-status badge on each listing. This is the extension's core feature
> on LinkedIn.

**host permission: `https://*.indeed.com/*`**
> Required for the content script to run on Indeed job search and job detail
> pages, for the same purpose as the LinkedIn permission above.

**webNavigation**
> LinkedIn and Indeed are single-page apps: navigating into their Jobs
> section from elsewhere on the same site (e.g. clicking "Jobs" from the
> LinkedIn feed) is a client-side route change, not a page load, so Chrome's
> normal content-script injection never fires for that tab. This permission
> lets the background service worker detect that in-app navigation
> (`chrome.webNavigation.onHistoryStateUpdated`, filtered to LinkedIn Jobs
> and Indeed URLs only) and inject the extension's own already-declared
> content scripts, the same files listed under the `scripting` permission
> above. No navigation data is read, stored, or sent anywhere — the API is
> used only as a trigger to retry script injection.

**host permission: `https://linkedin-remote-checker-proxy.wherestheremote.workers.dev/*`**
> Required so the extension's background service worker can send a job
> posting's description text to our own backend classification service (a
> Cloudflare Worker that relays to OpenAI's API) and receive back the
> remote/hybrid/onsite classification. This is the only network destination
> the extension contacts besides LinkedIn and Indeed themselves.

## Data usage disclosure (Privacy practices tab)

- **Data collected:** Website content (the text of job postings on
  LinkedIn/Indeed pages you visit).
- **Purpose:** App functionality only — classifying the currently viewed job
  posting.
- **Sold to third parties:** No.
- **Used for purposes unrelated to the extension's single purpose:** No.
- **Used to determine creditworthiness or for lending:** No.
- Certify: data handling matches this disclosure.

## "Does your extension use remote code?"

**No.** All executed code ships inside the extension package
(`src/*.js`, loaded via the manifest or `chrome.scripting.executeScript`
with local file paths only). Network calls (`fetch` to the Cloudflare
Worker) exchange JSON data, not executable code — no `eval`, no
`new Function`, no remotely loaded `<script>` sources.

## Packaging checklist

Zip only the files the manifest needs — from the repo root:

```sh
zip -r extension.zip manifest.json icons src
```

Do not include `worker/`, `tests/`, `.git`, `.claude/`, `node_modules`,
`package-lock.json`, or `README.md` — none of it is required at runtime and
the `worker/` directory in particular pulls in unrelated tooling and
`node_modules`.
