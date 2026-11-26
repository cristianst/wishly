# Wishly – Environment setup

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in the two values below
npm run dev                  # http://localhost:5173
```

Frontend environment variables (publishable values only – **never** a service-role/secret key):

| Variable                        | Where to find it                                |
| ------------------------------- | ----------------------------------------------- |
| `VITE_SUPABASE_URL`             | Supabase dashboard → Project Settings → API     |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Supabase dashboard → Project Settings → API Keys |

Without these values the app still runs; the login page reports that sign-in is not configured.

## Checks

```bash
npm run lint && npm run format:check && npm run typecheck && npm test && npm run build
```

## Creator authentication (manual provider steps)

These steps need your own accounts and cannot be automated from the repository. The app code
for them is implemented, but **live sign-in has not been verified** until you complete them.

1. **Supabase project:** create a project, then copy the URL and publishable key into `.env.local`.
2. **Redirect allow-list:** Supabase → Authentication → URL Configuration. Set the Site URL and add
   every callback you use, for example:
   - `http://localhost:5173/auth/callback`
   - your Cloudflare Pages preview and production origins + `/auth/callback`
3. **Email magic link:** enable the Email provider (Authentication → Providers). The built-in mail
   sender is heavily rate-limited; configure a custom SMTP provider before real use.
4. **Google OAuth:**
   1. Google Cloud Console → APIs & Services → Credentials → create an **OAuth client ID** (Web application).
   2. Add the Supabase callback as an authorised redirect URI:
      `https://<project-ref>.supabase.co/auth/v1/callback`.
   3. Paste the client ID and secret into Supabase → Authentication → Providers → Google.

Sessions are stored by `supabase-js` in the browser and use the PKCE flow.
The magic-link email should be opened in the same browser that requested it.

## Auth email templates

Branded EN/ES/DE templates live in `supabase/templates/`.

**Hosted Supabase only lets you edit templates after custom SMTP is configured** (Project Settings →
Authentication → SMTP). Until then the default Supabase emails are sent. Once SMTP is set up, paste each
into Authentication → Emails:

| Dashboard template | Body                                    | Subject                                       |
| ------------------ | --------------------------------------- | --------------------------------------------- |
| Confirm signup     | `confirmation.html`                     | contents of `confirmation.subject.txt`        |
| Magic Link         | `magic_link.html`                       | contents of `magic_link.subject.txt`          |

The language comes from the `language` user metadata saved when an account is created
(see `signInWithMagicLink`). Accounts created before this change, and Google sign-ups, fall back to English.
The subject line is a single string and is not translated.

## Database (Phase 3)

The schema lives in `supabase/migrations/`. It creates `wishlists`, `wishlist_items` and `reservations`
with RLS enabled and column-level grants (clients cannot write `share_token`/`owner_id`, move a gift to
another list, or touch `reservations`).

**Apply it to your Supabase project** (one of):

- Dashboard → SQL Editor → paste the contents of `supabase/migrations/20261126120000_initial_schema.sql` → Run.
- Or with the Supabase CLI: `npx supabase link --project-ref <ref>` then `npx supabase db push --remote`.

Then confirm in Dashboard → Table Editor that each of the three tables shows "RLS enabled".

**Run the database tests locally** (needs Docker; uses a throwaway PostgreSQL container with a small
stand-in for Supabase's `auth` schema, so the real migration and policies are exercised):

```bash
npm run test:db
```

These tests do not talk to your hosted project. They prove the SQL is correct, not that it has been applied.

## Sharing (Phase 4)

Unlisted links are served by the `public-wishlist` Edge Function, which calls two locked-down database
functions (`get_public_wishlist`, `check_rate_limit`) with the server-side service-role key. Guests never
get direct table access.

1. **Apply the second migration**, `supabase/migrations/20261126130000_sharing.sql` (SQL Editor, or `npx supabase db push --remote`).
2. **Deploy the function** with the Supabase CLI (multi-file functions are awkward to paste into the dashboard):

   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase functions deploy public-wishlist --no-verify-jwt
   ```

   `--no-verify-jwt` (also set in `supabase/config.toml`) is required because guests are not signed in.
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase; do not copy that key anywhere else.
3. **Smoke test** with a share link from the app (the token is the last part of `/l/<token>`):

   ```bash
   curl -i -X POST "https://<ref>.supabase.co/functions/v1/public-wishlist" \
     -H "Content-Type: application/json" -d '{"token":"<token>"}'
   ```

   Expect `200` with the list for a valid token and `404 {"error":{"code":"NOT_FOUND"}}` for anything else.

Notes:

- The token is sent in a POST body rather than a query string so it stays out of access logs (the plan
  sketched `GET ?token=`; this is a deliberate, stricter deviation).
- Rate limit: 60 requests/minute per hashed client address, stored in `rate_limits` (shared across instances).
- `public/_headers` adds `noindex`, `no-referrer` and `no-store` for `/l/*` on Cloudflare Pages.
- Rotating a link in the editor invalidates the old one immediately.
- The Edge Function entry file (`index.ts`) has not been run against a live project from here; the handler logic
  is covered by `npm test` and the SQL by `npm run test:db`.

## Reservations (Phase 5)

Guests reserve gifts anonymously. A random 256-bit secret is created in the browser, saved in
`localStorage` (`wishly:reservation:<item-id>`) **before** the request, and sent over HTTPS to the
`reservations` Edge Function, which stores only its SHA-256 digest. `UNIQUE(item_id)` makes reserving atomic.

1. **Apply the migration** `supabase/migrations/20261126140000_reservations.sql`.
   If you applied earlier migrations by pasting SQL, mark them as applied first so the CLI does not re-run them:
   `npx supabase migration repair --remote --status applied <version>` (see `npx supabase migration list --remote`).
   Then `npx supabase db push --remote`.
2. **Deploy both functions** (guests are not signed in, hence `--no-verify-jwt`; also set in `supabase/config.toml`):

   ```bash
   npx supabase functions deploy reservations --no-verify-jwt
   npx supabase functions deploy reservation-ownership --no-verify-jwt
   ```

   Redeploy `public-wishlist` too if you have not since this phase (it now reports `reserved` per gift).
3. **Try it:** open a share link in two different browsers (or one normal and one private window).
   Reserve a gift in the first; the second shows "Already reserved" (after a refresh until Phase 6 adds live updates).

Limitations (by design, see the plan):

- Cancelling is tied to the browser that reserved. Clearing site data or switching device means the reservation
  cannot be cancelled by the guest; the list owner can still delete the gift.
- If `localStorage` is blocked, the app warns and keeps the secret in memory for the current page only.
- Rate limits: 30 reserve/cancel requests and 60 ownership checks per minute per hashed client address.
- Owners see *that* a gift is reserved, never by whom.

## Keeping pages current (Phase 6)

**Deliberate deviation from the plan (§7, Supabase Realtime Broadcast):** the MVP does *not* use Realtime.
It was built, tested, and then removed in favour of something much simpler, because for a small family
wishlist the extra moving parts (database triggers, a public broadcast channel, a client subscription, and a
failure mode that is silent when misconfigured) were not worth a few seconds of freshness. Add it later if
usage proves it necessary; the design (minimal `{type, itemId}` hints on a topic derived from the share token,
treated purely as a refetch signal) is described in the plan.

What happens instead:

- Open pages quietly refetch every **30 seconds** (`LIVE_REFRESH_MS` in `src/lib/polling.ts`):
  the guest page (list and "is this mine?" check) and the owner's reservation badges.
- Polling **pauses while the tab is hidden** and refetches immediately when it becomes visible again.
- It is **non-intrusive**: it updates in place (no loading state, no remounting, scroll and focus untouched),
  never touches forms the owner is editing, and a *failed* background refresh keeps the current list on screen.
  Only a rotated/deleted link replaces the page, and polling then stops.
- If someone reserves a gift that was just taken, the server answers "already reserved"; the page shows
  that message and refreshes to the new state.
- Cost: about 2 requests per minute per open page, well under the 60/min rate limit of `public-wishlist`.

## Product import (Phase 7)

In the add/edit gift form, paste a product link and press **Import details**. The `product-metadata` Edge Function
fetches the page and returns the title, image link, price/currency and description it can find (schema.org JSON-LD
first, then Open Graph, Twitter cards, `<title>`). Everything lands in the normal editable form; if nothing can be
read, the form simply continues in manual mode.

**Deploy** (no migration, no new secrets; it reuses `check_rate_limit` from the sharing migration):

```bash
npx supabase functions deploy product-metadata --no-verify-jwt
```

`--no-verify-jwt` (also set in `supabase/config.toml`) only disables the gateway check. The function itself verifies
the caller against the auth server on every request and **rejects anonymous and signed-out callers with 401**.

How it behaves:

- **Images are linked, never copied.** Only the image URL is stored (`image_url`); the picture stays on the shop's
  server and is shown from there (`referrerpolicy="no-referrer"`). If a shop blocks loading its images on other
  sites, the form says so and you can paste a different image link.
- **Prices are never guessed.** A price is returned only if the page states exactly one; otherwise it is left empty.
  Prices are a snapshot at import time, not tracked.
- **Honest about being a bot.** The fetcher identifies itself as `WishlyBot` and does **not** impersonate a browser
  or try to get around bot protection. Shops that refuse automated requests (HTTP 400/403/429/503, JavaScript-only
  pages, …) fall back to manual entry with a clear message. Some large retailers will do this; that is expected.
- **Some shops cannot be imported, by design.** OTTO, for example, answers automated requests with a
  JavaScript bot-challenge page (Kasada, HTTP 400). Reading it would mean pretending to be a browser or defeating
  the shop's bot protection, which this app deliberately does not do (and a headless browser such as Playwright
  cannot run inside Supabase Edge Functions anyway). A third-party preview service (Microlink) was tried and
  could not read it either. For these shops, enter the name and image link by hand: open the product page, copy
  the image address, and paste it.
- **Amazon works, best-effort.** Amazon serves its product page to the importer, but its Open Graph tags are only a
  generic share card (title "Amazon", a logo). The importer therefore skips generic tags and reads the page's real
  `<title>`, `#productTitle` and `#landingImage` (amazon.de, .co.uk, .com, … and the redirects from short links).
  This depends on Amazon's markup and may break when it changes, in which case it falls back to the page title.
  Amazon's prices are intentionally not imported (a page shows many prices). Amazon's terms restrict automated
  access; imports are one-off, user-triggered and rate-limited, but Amazon's official route is the Product
  Advertising API if you ever need guaranteed data.
- **Generic results are never imported as products.** A title that is only the shop's name, a logo/share-card image,
  or an error/challenge page is skipped; if nothing specific is left the result is reported as "blocked".
- **SSRF protection** (`supabase/functions/_shared/ssrf.ts`, `safeFetch.ts`): http(s) only, ports 80/443 only, no
  credentials in URLs, no `localhost`/internal names, every IP form normalised (decimal/hex/octal) and checked
  against private, loopback, link-local (incl. cloud metadata `169.254.169.254`), CGNAT, multicast and reserved
  ranges for IPv4 and IPv6. DNS is resolved and vetted for the first URL **and every redirect** (redirects are
  followed manually, max 4), one 8 s deadline, 1.5 MB cap, HTML content types only, no cookies / auth / referrer sent.
- **Residual risk (DNS rebinding):** the HTTP client resolves the name again when it connects, so a hostile DNS
  server could theoretically answer differently the second time. Edge Functions run in an isolated runtime, which
  limits what that could reach; pinning the connection to the vetted IP is not possible with the Deno `fetch` API.
- **Limits:** 20 imports per minute per user (database-backed). URLs are never logged; failures log only a reason code.
- **Variation parameters are kept.** The link you paste is stored exactly as typed (minus the `#fragment`), so
  e.g. `?variationId=…` survives.

Try it: sign in, open a list, **Add gift**, paste a product link, **Import details**.
The Edge Function entry file (`index.ts`: auth call, DNS lookup) has not been run against a live project from here;
everything else is covered by `npm test`.

## Polish and hardening (Phase 8)

### Accessibility

- **Automated:** `src/a11y.test.tsx` runs axe-core on every screen (landing, login incl. errors, not-found, dashboard,
  new list with validation errors, editor with gifts / share section / add-gift form, delete dialog, guest page with
  available / taken / "mine" gifts, unavailable link) in **English, Spanish and German**. jsdom has no layout, so
  colour contrast and landmark-region rules are excluded there and covered by the manual check below.
- **Navigation:** a single-page app does not reload, so moving between pages moves focus to the main content and
  announces the new page title to screen readers (`AppShell`). The first load is left to the browser. A skip link and
  `aria-live` status regions exist; dialogs use Radix (focus trap, Escape, focus return).
- **Contrast (checked by hand with the WCAG formula against the real palette in `src/styles/index.css`):**

  | Pair | Ratio | Needs |
  | --- | --- | --- |
  | ink on canvas (body text) | 16.6 : 1 | 4.5 |
  | muted on canvas / on white card | 5.8 / 6.0 : 1 | 4.5 |
  | brand on white / on canvas / on brand-soft | 5.6 / 5.3 / 4.8 : 1 | 4.5 |
  | white on brand (button) / on brand-strong (hover) | 5.6 / 7.6 : 1 | 4.5 |
  | error red-700 on white, warning amber-900 on amber-50 | 6.5 / 8.8 : 1 | 4.5 |
  | form-control border (`--color-field`) on white card / canvas | 3.7 / 3.5 : 1 | 3.0 (non-text) |

  Re-check these if you change a colour token. The auth email templates use hand-picked hex approximations of the brand
  colour (email clients do not support `oklch`) and do not follow the tokens automatically.

### Responsive layout

Verified in a real browser at **320 px** wide, in English and German (longest words), on the dashboard, list editor with
the add-gift form open, and the guest page, using long unbroken names to stress wrapping: no horizontal scrolling and
every interactive element at least 44 x 44 px. User-entered text (titles, descriptions, pasted names) wraps anywhere
(`wrap-anywhere`) so a long URL cannot push a card off-screen. The header controls wrap onto a second row on narrow screens.

### Performance

Pages are loaded on demand (route-level lazy loading) and libraries are split into cacheable vendor chunks
(`vite.config.ts`): the largest file is about 310 kB (98 kB gzip) and each page is 1-13 kB, so a guest opening a shared
link never downloads the editor, forms or import code.

### Security headers (`public/_headers`, Cloudflare Pages)

- **Content-Security-Policy:** `script-src 'self'` (no inline or eval), `connect-src 'self' https://*.supabase.co`,
  `img-src 'self' data: https:` (merchant images are hot-linked), `object-src 'none'`, `frame-ancestors 'none'`,
  `base-uri` / `form-action` `'self'`, `upgrade-insecure-requests`. `style-src` keeps `'unsafe-inline'` because Radix UI
  injects `<style>` tags for scroll locking; scripts are the part that matters.
- **Verified:** the built app was served with exactly these headers and loaded in a browser with a clean console
  (landing, login, and a shared link that really called Supabase). `tests/integration/security/headers.test.ts` guards the policy.
- **If you use a custom Supabase domain**, add it to `connect-src`; if a future feature loads scripts, fonts or frames
  from another origin, it must be added deliberately.
- Also set: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Permissions-Policy`, a 1-year immutable cache for hashed
  assets, and `no-referrer` / `noindex` / `no-store` for `/l/*`.

### Not done yet

- **End-to-end browser tests (Playwright)** need a browser download and a test Supabase project; planned separately.
- A **manual screen-reader pass** (VoiceOver / NVDA) has not been done; automated checks cannot replace it.
