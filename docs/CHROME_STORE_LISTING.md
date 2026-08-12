# Chrome Web Store listing — copy to paste into the dashboard

Reference text for the Developer Dashboard's "Store listing" and "Privacy
practices" tabs. Nothing here needs to ship inside the extension package.

## Privacy policy URL

Live (GitHub Pages, deploying from `main` / `/docs`):

```
https://seanrapsontravel-sketch.github.io/wheres-the-remote/privacy.html
```

## Single purpose description

> Where's the remote? analyzes job postings on LinkedIn and Indeed and shows
> whether a role is genuinely remote, hybrid, onsite, or requires travel,
> based on the posting's own description text rather than the platform's
> "Remote" label.

## Permission justifications

**storage**
> Three things, all minimal. (1) Each job listing's classification result is
> cached locally (`chrome.storage.local`) for 14 days, keyed by job ID, so a
> listing already analyzed isn't re-sent for classification on revisits,
> pagination, or a later search; expired entries are deleted. (2) A random
> identifier generated at install time is stored locally and sent with
> classification requests so the backend can rate-limit each installation;
> it is not derived from the user or device and is linked to no account.
> (3) The single "hide hybrid & non-remote roles" on/off preference is stored
> in `chrome.storage.sync` so it follows the user across their signed-in
> Chrome installations. No job data, browsing history, or personal data is
> stored in either area.

**scripting**
> Used only to re-inject the extension's own already-declared content
> scripts (`src/site.js`, `src/classifier.js`, `src/cache.js`,
> `src/extractor.js`, `src/badge.js`, `src/aggregate.js`, `src/settings.js`,
> `src/filter.js`, `src/content.js`, `src/badge.css`) into LinkedIn/Indeed
> job tabs that were already open when the extension is installed, updated,
> or the browser restarts, since Chrome does not automatically retrofit
> content scripts into existing tabs. No remote or dynamically generated code
> is ever injected — only the extension's own bundled files.

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

Tick **Website content** only. Everything below must stay consistent with
`docs/privacy.html` — the dashboard disclosure and the policy are checked
against each other, and against what the code actually does.

- **Data collected:** Website content — the text of job cards in LinkedIn/
  Indeed search results, and the text of the job posting pages themselves.
  The posting's description is transmitted for classification; the rest is
  read on-device only, to identify the listing and detect expired postings.
- **Purpose:** App functionality only — classifying the currently viewed job
  posting.
- **Sold to third parties:** No.
- **Used for purposes unrelated to the extension's single purpose:** No.
- **Used to determine creditworthiness or for lending:** No.
- Certify: data handling matches this disclosure.

Two points to be ready to answer on, since both have tripped up reviews:

- **Job descriptions can incidentally contain personal information** (a hiring
  manager's name, an email address, a phone number) because employers write
  them. That text is transmitted as part of the description. The extension
  does not extract, store or use it. `docs/privacy.html` says this explicitly
  rather than claiming that no personal information is ever transmitted.
- **The install identifier is not "user data"** in the sense the form means:
  it is a random value created on the device, used solely to rate-limit the
  backend, and tied to nothing else. It is still disclosed in the privacy
  policy, because Chrome expects all collection to be disclosed, and because
  a reviewer who sees an identifier header and no mention of it in the policy
  will reasonably assume the worst.

If a later version changes any of this, update `docs/privacy.html` **and**
this tab in the same release. Chrome requires practice changes to be
disclosed prominently, and a policy that lags the shipped behaviour is
grounds for removal, not just rejection.

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
