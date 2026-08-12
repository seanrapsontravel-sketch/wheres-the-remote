# Chrome Web Store listing — copy to paste into the dashboard

Reference text for the Developer Dashboard's "Store listing" and "Privacy
practices" tabs. Nothing here needs to ship inside the extension package.

## Privacy policy URL

Live (GitHub Pages, deploying from `main` / `/docs`):

```
https://seanrapsontravel-sketch.github.io/wheres-the-remote/privacy.html
```

## Store listing fields

**Category:** Productivity

**Language:** English (United Kingdom)

**Summary / short description**

> See whether LinkedIn and Indeed jobs are truly remote, hybrid, onsite, or
> travel-heavy—based on the full job description.

**Detailed description**

> Stop relying on the platform's "Remote" label alone.
>
> Where's the remote? reads the job description and adds a clear verdict to
> LinkedIn and Indeed listings: Remote, Hybrid, Onsite, Travel, or Not stated.
> Open a verdict to see the evidence behind it, including any stated office
> attendance or travel requirement.
>
> Use the optional filter to hide hybrid and non-remote roles, so you can focus
> on jobs that match the way you actually want to work.
>
> FEATURES
> • Clear remote-work verdicts beside job listings
> • Short evidence summaries based on the posting itself
> • Office-frequency and travel indicators when stated
> • Optional filtering of hybrid and non-remote roles
> • Support for LinkedIn Jobs and Indeed
> • 14-day local result cache to avoid checking the same listing repeatedly
>
> YOUR CHOICE AND PRIVACY
> Before the first remote check, the extension explains that up to 8,000
> characters of a job description and a random installation identifier will
> be sent through our Cloudflare-hosted service to OpenAI. Nothing is sent
> until you select “Enable remote checks”. You can pause checks and clear
> locally saved results at any time.
>
> The extension does not require an account, include advertising, track you
> across sites, or read pages outside LinkedIn and Indeed job sections. See the
> privacy policy for full details.

## Media assets

- **Small promotional tile (440×280):**
  `chrome-store-assets/small-promo-tile-440x280.png`
- **Screenshots (1280×800), in upload order:**
  1. `chrome-store-screenshots/01-indeed-remote-reality.jpg` — See the real
     working pattern directly in Indeed results.
  2. `chrome-store-screenshots/02-linkedin-remote-reality-filtered.jpg` — Hide
     hybrid and non-remote roles in one click.
  3. `chrome-store-screenshots/03-linkedin-all-verdicts.jpg` — Compare Remote,
     Hybrid, Onsite, Travel, and Not stated verdicts at a glance.
  4. `chrome-store-screenshots/04-indeed-evidence-and-not-stated.jpg` — Expand a
     verdict to see the evidence behind it.
  5. `chrome-store-screenshots/05-linkedin-true-remote-detail.jpg` — Confirm a
     genuinely remote role from the full posting.

## Reviewer test instructions

1. Install the extension and open a LinkedIn Jobs search page or an Indeed
   search page containing job results.
2. On the inline first-run card, select **Enable remote checks**.
3. Wait for verdict badges to appear beside listings, then select a badge to
   view its evidence.
4. Turn on **Hide hybrid & non-remote** to verify filtering.
5. Select **Pause remote checks** to verify that new classifications stop;
   select **Clear saved results** to remove the local cache.

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

## In-product disclosure and consent

On the first LinkedIn or Indeed jobs page, the extension displays an inline
activation card before it extracts or transmits any job description. The card
states that up to 8,000 characters of each description and a random install
identifier are sent to the Cloudflare-hosted classification service and
OpenAI, and that results are saved locally for 14 days to avoid repeat checks.
Classification starts only after the user selects **Enable remote checks**.
**Not now** leaves it disabled, and **Pause remote checks** withdraws consent.

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
