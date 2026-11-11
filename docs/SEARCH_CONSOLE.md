# Google Search Console (optional, read-only)

The intake page (`/trial/new`) has a **Use Google Search Console** switch. When it is on and the Google account can read a Search Console property for the website, Understand reads the last 90 days of Google search data for that site. It uses the data to:

- read the most-searched pages first when the crawl budget is tight;
- add one country vote to the location (weight 2, below a written address and below what the operator typed on the intake page);
- give the understanding model customer wording, as data it may not cite as evidence;
- show a **Search demand** section on Understand once the analysis is complete.

Topics and prompts don't use Search Console yet (phase 2).

Without the setup below, the switch is disabled, shows these steps, and the app works exactly as before. The crawl pipeline then records `search_console.sync.skipped` with `reason: "oauth_not_configured"` and makes no request to Google.

## Setup (about 10 minutes, once per computer)

1. In [Google Cloud console](https://console.cloud.google.com/), create or pick a project. Open **APIs & Services → Library**, then enable **Google Search Console API**.
2. Open **APIs & Services → OAuth consent screen**:
   - user type **External**, publishing status **Testing**;
   - under **Test users**, add the Google account that can see your site in Search Console (up to 100 users);
   - under **Data access**, add the scope `https://www.googleapis.com/auth/webmasters.readonly`, and nothing else.
3. Open **Credentials → Create credentials → OAuth client ID**, application type **Web application**. Under **Authorized redirect URIs**, add:
   - `http://localhost:3000/api/integrations/search-console/callback` (`npm run dev` / `npm start`);
   - the same path on any other host or port you open, for example `http://127.0.0.1:3100/...` for Playwright (its `baseURL`).
   The switch's **Setup steps** show the exact URI for the address you opened the app on.
4. Add the values to `.env.local`, then restart the app:
   ```
   GOOGLE_OAUTH_CLIENT_ID=…apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=…
   ```
5. On `/trial/new`, switch **Use Google Search Console** on and start the analysis. Google shows "Google hasn't verified this app": continue as the test user, then allow read-only access. You return to the intake page and the analysis starts.

### Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | none | OAuth client of type Web application. Required. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | none | Client secret. Required. Also derives the key that encrypts the stored token and the key that signs the OAuth state cookie. |
| `GOOGLE_OAUTH_REDIRECT_URI` | derived | Exact registered redirect URI. Needed only when the app is opened on a non-loopback address. On `localhost`, `127.0.0.1` and `[::1]` it is derived from the address in the browser (the request's Host header, not the address Next listens on), so register the callback for the address you actually open: `http://127.0.0.1:3000/…` and `http://localhost:3000/…` are different redirect URIs to Google. A non-loopback address works only when it is the host of this URI. |
| `SUN_GSC_DISABLED` | unset | `1` turns the integration off even when the client is configured. |
| `SUN_GSC_LOOKBACK_DAYS` | `90` | Days of data to read (clamped to 7–480). |
| `SUN_GSC_WAIT_MS` | `20000` | How long Understand waits for the pull before continuing without it. |

## What happens on a crawl

1. `POST /api/projects/[id]/crawl` with `{ "searchConsole": { "enabled": true } }` starts the pull alongside the crawl. A bodiless re-crawl reuses the previous run's choice; `enabled: false` turns it off.
2. The pull (`src/lib/search-console/pull.ts`) makes at most six requests:

   | # | Request | Used for |
   |---|---|---|
   | 1 | `sites.list` | picking the property |
   | 2 | Search Analytics, no dimensions | totals, including anonymized searches |
   | 3 | `query`, 1,000 rows | brand vs non-brand demand, customer wording, place mentions |
   | 4 | `page`, 500 rows | crawl priority |
   | 5 | `country`, 250 rows | country shares |
   | 6 | `query` within the top country, 1,000 rows | place mix; skipped when one country has ≥ 90% |

   - **Window:** it ends three Pacific-time days ago (Google's newest days are preliminary), `type: web`, `dataState: final`.
   - **Cache:** a re-crawl of the same site within 12 hours is served from memory with no requests.
3. **Property matching:** a Domain property for the host wins, then the exact URL-prefix origin, then the other scheme, then the `www` variant, then a parent Domain property. When the property covers more than the project (for example `sc-domain:example.com` for `shop.example.com`), every query carries a page filter, so other subdomains aren't counted.
4. **Events** (payloads carry counts and reasons only, never query text or tokens):
   - `search_console.sync.started` `{crawlRunId, startDate, endDate}`;
   - then exactly one of:
     - `…completed` `{siteUrl, matchReason, queries, pages, countries, sufficient, brandedClickShare, durationMs}`;
     - `…skipped` `{reason, propertyCount?}`;
     - `…failed` `{reason, httpStatus?}`.
5. **Storage:**
   - the raw snapshot goes to the evidence store (`SUN_EVIDENCE_TTL_DAYS`);
   - the code-computed summary is saved in the profile version as `profile.searchConsole`;
   - profile versions are immutable, so disconnecting doesn't remove it from earlier versions.

Brand vs non-brand is computed in code from the business's own name and domain, because Google's branded filter has no API. A short one-word brand that is also a word the site sells is counted as neither. A site is used only when it has at least 100 non-brand impressions and 10 visible queries in the window. Small local sites often don't, because Google hides rare searches.

## Security and privacy

- **Scope:** only `webmasters.readonly`. There are no email or profile scopes, so nothing about the Google account is stored.
- **Refresh token:** stored in one `provider_credentials` row (`provider = "google_search_console"`) as an AES-256-GCM envelope. The key is derived from the client secret, so a copied `sun.db` alone is useless, and rotating the secret means reconnecting. The row is not reachable through `/api/providers/credentials`.
- **Access token:** kept in memory only.
- **OAuth `state`:** bound to the browser by a signed, httpOnly, 10-minute cookie. Return addresses are limited to same-origin `/trial/new` and `/projects/…` paths. `POST …/disconnect` requires the app's own `Origin`.
- **Query text:** filtered (no emails, phone numbers or URLs; markup characters removed) before it reaches the understanding model, and never as evidence or in system instructions. Search Console data stays on this computer; search terms are shared with the AI model that reads the site.
- **Requests:** only fixed Google hosts, with redirects refused and a 10-second timeout. Quota errors are not retried.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Switch disabled: "isn't set up on this computer" | Client ID or secret missing from `.env.local`, or the app wasn't restarted. |
| Switch disabled: "Set GOOGLE_OAUTH_REDIRECT_URI" | The app was opened on a LAN or remote address. Register that URI and set the variable. |
| Google shows `redirect_uri_mismatch` | The port changed (`npm run dev` moves off :3000 when it is busy). Register the URI shown in **Setup steps**. |
| "Your Google connection expired" | Testing-mode refresh tokens expire after 7 days, or access was revoked. Switch on again to reconnect. |
| Understand says no property for this website | The connected account can't see a property for this domain. Demo and third-party sites always hit this; use a site you own in Search Console. |
| "Too few searches without your name" | Under 100 non-brand impressions or 10 visible queries in the window. Nothing from Search Console is used. |
| "Google's Search Console limit was reached" | Quota error. Wait 15 minutes; the app doesn't retry. |

## Not verified

- No live Google call has been made by the automated tests; they all use a stubbed `fetch`.
- Whether Google classes `webmasters.readonly` as a sensitive scope. It makes no difference in Testing mode.
- The alpha-3 value Search Console uses for Kosovo. Both `XKX` and `XKK` map to `XK`.
- A service-account alternative (phase 3) is not implemented.
