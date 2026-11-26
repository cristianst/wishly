# Wishly — Product & Technical Implementation Plan

**Status:** Approved MVP specification; implementation has not started.  
**Repository:** https://github.com/cristianst/wishly  
**Working product name:** Wishly  
**Last revised:** 2026-11-26  
**Primary audience:** A coding agent implementing the app incrementally.

## 1. Product vision and decisions

Wishly is a modern, mobile-first application for creating and sharing gift wishlists. Authenticated creators can manage multiple lists and invite guests through unlisted URLs. Guests can browse lists, visit merchant links, and reserve gifts anonymously so other visitors know those gifts are taken.

**Non-negotiable decisions**

| Area | Decision |
| --- | --- |
| Frontend | React + Vite + TypeScript |
| UI | Tailwind CSS, shadcn/ui, Lucide icons |
| Navigation | React Router |
| Server state | TanStack Query |
| Forms and validation | React Hook Form + Zod |
| Backend | Supabase: PostgreSQL, Auth, Edge Functions, Realtime |
| Hosting | Cloudflare Pages, GitHub-connected deployments |
| Creator login | Google OAuth and email magic link |
| Anonymous guest login | None required |
| Creator lists | Multiple |
| Share model | Unlisted, unguessable links; anyone with URL may read |
| Reservations | Database-backed; only reservation holder can cancel |
| Product import | Best-effort metadata extraction, editable/manual fallback |
| Languages | English default, Spanish, German; locally selected |
| Translations | JSON resources through i18next/react-i18next; no hardcoded UI strings |
| V1 scope | Core creation, sharing, reservations, live state, importing |

**Success principle:** A guest can open a shared wishlist and reserve a gift in two or three interactions, without signing in.

**Acceptance:** A functional, secure, responsive, accessible, tested, deployable MVP. Do not treat wireframes, mock data, or placeholder APIs as complete functionality.

## 2. Roles and user journeys

### 2.1 Wishlist creator

- Sign in using Google or an email magic link; remain signed in until session expiration/sign-out.
- Create any number of wishlists, each with a required title and optional description.
- View lists in a dashboard with item counts and sharing controls.
- Add, edit and delete gifts; manually enter details or prefill from product URL.
- Copy an unlisted URL; regenerate its access token to revoke the previous URL.
- See all gift availability states, including the existence of anonymous reservations, but never guest identities.
- Delete a list, with its items and reservations cascading.

### 2.2 Guest/recipient

- Open a share URL without registering.
- View a wishlist's title, description, item images, names, descriptions, prices (when available), merchant links and reservation status.
- Reserve a currently available gift.
- Cancel **only** a reservation made in their current browser/storage context.
- See updates from other visitors and from the creator without refreshing.
- Switch interface language independently of creator and other visitors.

### 2.3 Deliberate MVP constraints

- Exactly one creator/owner per wishlist; no collaborative editing.
- Exactly one active reservation per gift; no quantities or partial reservations.
- Guest identities are not collected; cancellation is tied to possession of a browser-held secret.
- Losing the secret (clearing localStorage, using another browser/device) means the reservation cannot be reclaimed/canceled through self-service.
- Product prices are import-time snapshots, **not** live price tracking.
- User-supplied list/gift content is preserved in its original language; it is not machine translated.

## 3. Technical architecture

\`\`\`text
Browser: React/Vite SPA
  |-- Supabase Auth (Google + email magic link)
  |-- Supabase PostgREST for owner-only CRUD, protected by RLS
  |-- Supabase Edge Functions for public read, reservations and product import
  |-- Supabase Realtime Broadcast for minimal change notifications
  |-- localStorage for UI language and guest reservation secrets

Supabase PostgreSQL
  |-- wishlists
  |-- wishlist_items
  |-- reservations
  |-- RLS, constraints, indexes, minimal broadcast triggers

GitHub -> checks -> Cloudflare Pages build/deploy
GitHub Actions / Supabase CLI -> migrations and Edge Function deployment
\`\`\`

No custom always-running Node.js backend. Cloudflare serves only the static frontend; server-only logic lives in Supabase Edge Functions/database transactions. Ensure metadata parsing libraries work in the Edge Functions' Deno-compatible runtime rather than assuming any Node-only package will work.

**Architectural boundary:** Browser code may use the Supabase publishable key but must never receive a Supabase secret/service-role key. Public guest reads should not expose direct read privileges over private tables.

## 4. Data model

Write all schema changes as reviewed, version-controlled SQL migrations. Generate TypeScript database types where possible.

### 4.1 \`wishlists\`

| Column | Type | Constraints |
| --- | --- | --- |
| \`id\` | \`uuid\` | Primary key, generated |
| \`owner_id\` | \`uuid\` | Not null; FK to \`auth.users\` |
| \`title\` | \`text\` | Not null, trimmed, length 1–100 |
| \`description\` | \`text\` | Nullable, capped length |
| \`share_token\` | \`text\` | Not null, unique, high-entropy |
| \`created_at\` | \`timestamptz\` | Not null, default now |
| \`updated_at\` | \`timestamptz\` | Not null, maintained |

Index \`owner_id\`. Generate at least 128 bits of CSPRNG entropy; prefer 256 bits encoded as base64url. Do not use sequential IDs or timestamps as share tokens. Ensure token regeneration is restricted to owners.

### 4.2 \`wishlist_items\`

| Column | Type | Constraints |
| --- | --- | --- |
| \`id\` | \`uuid\` | Primary key |
| \`wishlist_id\` | \`uuid\` | FK to wishlists, not null, on delete cascade |
| \`title\` | \`text\` | Not null, trimmed, bounded |
| \`description\` | \`text\` | Nullable, bounded |
| \`product_url\` | \`text\` | Nullable, validated URL |
| \`image_url\` | \`text\` | Nullable, validated URL |
| \`price\` | \`numeric(12,2)\` | Nullable, >= 0 |
| \`currency\` | \`char(3)\` | Not null, default \`EUR\` |
| \`created_at\` | \`timestamptz\` | Not null |
| \`updated_at\` | \`timestamptz\` | Not null |

Index \`wishlist_id\`. For MVP sort items consistently by creation date. No drag-and-drop ordering required.

### 4.3 \`reservations\`

| Column | Type | Constraints |
| --- | --- | --- |
| \`id\` | \`uuid\` | Primary key |
| \`item_id\` | \`uuid\` | Not null, unique, FK to wishlist_items, on delete cascade |
| \`claim_token_hash\` | \`text\` | Not null, SHA-256 digest of guest secret |
| \`created_at\` | \`timestamptz\` | Not null, default now |

**Critical invariant:** \`UNIQUE(item_id)\` permits at most one active reservation. A canceled reservation is deleted. Do not create a second independently mutable \`is_reserved\` flag on the gift.

### 4.4 Ownership and timestamp rules

- All owner CRUD authorization must be enforced by RLS.
- \`owner_id\` must not be arbitrarily reassignable.
- On item update, enforce that both old and new parent wishlist are owned by the caller.
- Set \`updated_at\` server-side.
- Apply foreign keys, length limits and input validation at both API and database boundaries where reasonable.

## 5. Authorization and access

Enable RLS on **every** app table. Write integration tests against the actual policies, not only mocked functions.

### 5.1 Owner CRUD policies

- \`wishlists\`: authenticated owner can select/update/delete their lists; authenticated permanent users can insert a row only with \`owner_id = auth.uid()\`.
- \`wishlist_items\`: insert/select/update/delete allowed only when the parent wishlist is owned by \`auth.uid()\`; enforce \`USING\` and \`WITH CHECK\`.
- \`reservations\`: deny direct client CRUD by default. Creator access to reservation status must be sanitized, through a controlled API or projection.
- Public \`anon\` must not be able to enumerate private records by directly querying \`wishlists\` or \`wishlist_items\`.

Prefer generating share tokens server-side. If a security-definer database routine is used, constrain EXECUTE grants, bind its \`search_path\`, and validate permissions.

### 5.2 Public read endpoint

Implement a public, controlled Edge Function, logically:

\`GET /public-wishlist?token=<high-entropy-share-token>\`

- No visitor registration required.
- Validate token syntax and length.
- Resolve matching wishlist; return sanitized title, description and item data.
- Include derived \`reserved: boolean\` per item; never expose owner email, claim token hash, guest secrets or privileged data.
- Unknown/rotated token returns indistinguishable friendly 404.
- Apply \`Cache-Control: no-store\` to reservation-sensitive responses.
- Add rate limiting and appropriate CORS.
- Ensure anonymous Edge Function routes are configured to allow unauthenticated calls without weakening owner-side authentication.

The share token is a capability: treat possession as permission to read. Set \`Referrer-Policy: no-referrer\` or equivalently strict policy on shared pages, including external merchant links, so the token does not leak through referrers. Add \`noindex\` and no public directory; these are privacy measures, not substitutes for secure tokens.

### 5.3 Creator visibility

Owners can see reservation statuses without accessing or discovering reservation secrets. The frontend may reuse its own public share route or use a sanitized authenticated endpoint. Make owner editing unaffected by gift reservation state.

## 6. Anonymous reservations and concurrency

### 6.1 Guest secret

- Generate a cryptographically random **256-bit** secret with Web Crypto on first reservation attempt.
- Save the secret in localStorage under a scoped item key, e.g. \`wishly:reservation:<item-id>\`.
- Send it only to the reservation API over HTTPS.
- On the server compute SHA-256, store only the digest, and never echo raw secret or digest in responses, events or logs.
- The guest's storage is the only MVP recovery mechanism; do not claim cross-device recovery.
- Avoid putting secrets in URLs or query parameters.

### 6.2 API operations

Implement backend endpoints/functions logically equivalent to:

- \`POST /reservations\`: \`{shareToken, itemId, reservationSecret}\`. Validate item membership, then **atomically** insert. Success \`201\`; if the same digest already owns it, idempotent \`200\`; if another owner holds it, \`409\`. Other errors: \`400\` invalid, \`404\` missing, \`429\` rate-limited.
- \`DELETE /reservations\`: \`{shareToken, itemId, reservationSecret}\`. Validate share/item and compare digest atomically before deletion. A mismatched token must never cancel an existing reservation.
- \`POST /reservation-ownership\`: bounded batch of \`{itemId, reservationSecret}\` proofs plus share token; return only which supplied item IDs belong to those proofs. This is necessary to distinguish **reserved by you** from **reserved by someone else** after refresh. Never assume a localStorage entry alone proves ownership.

The ownership endpoint is especially important when a previous reservation was released and another visitor reserved the same item. The user must not be shown a false "Reserved by you" label simply because an old local token remains.

### 6.3 Atomicity

Use database transactions, a tightly scoped RPC or conditional SQL. A check-then-insert sequence without the unique constraint is forbidden. Under concurrent reservations, exactly one distinct owner may succeed.

When a network response is lost, the client should preserve the pending secret and reconcile by querying ownership before retrying or clearing it. Only show confirmed success after the server acknowledges or reconciliation proves ownership.

### 6.4 Guest UI

- Available: "I'll get this 🎁"
- Reserved by current browser: "Reserved by you" and "Cancel reservation"
- Reserved by someone else: "Already reserved" and disabled reservation action
- Pending request: disabled/reassuring loading state, not premature success
- If storage is unavailable, warn that cancellation may not be recoverable.

Protect endpoints with input size limits and abuse-aware shared rate limiting. Browser-only limits are insufficient. Add anti-automation protection if abuse warrants it.

## 7. Real-time updates

Use **Supabase Realtime Broadcast** to deliver minimal wishlist change notifications.

- Emit from trusted database changes to items/reservations, on a topic scoped to the high-entropy share token, e.g. \`wishlist:<token>\`.
- Broadcast an invalidation event such as \`{type: "wishlist_changed", itemId: "..."}\`; never broadcast table rows, claim hashes, server secrets or PII.
- For the MVP, a public channel with hard-to-guess topic is acceptable as an event hint; client-originated broadcast events are **not trusted** and cannot alter the source of truth.
- Subscribe when a list opens, fetch state, reconcile after subscription, debounce events, and refetch sanitized server state on updates.
- Reconcile on reconnect, tab focus and after mutations.
- Handle duplicate, missing and out-of-order notifications, multiple tabs and deleted items.
- Verify Supabase trigger/function choice against current supported Realtime API. Restrict publish content to explicitly public data.
- If the public-channel threat model grows, migrate to private channels with explicit Realtime authorization.

**Target:** Under normal connectivity, other viewers see confirmed changes in roughly two seconds. Correctness is more important than exact delivery latency.

## 8. Product metadata import

Implement a **creator-authenticated** Supabase Edge Function \`POST /product-metadata\` accepting \`{url}\`.

### 8.1 Extraction pipeline

1. Validate remote HTTP(S) URL and obtain a bounded HTML response.
2. Parse Schema.org JSON-LD Product nodes, including arrays and \`@graph\` (name, description, image, \`offers.price\`, \`offers.priceCurrency\`).
3. Fall back to Open Graph title/image/description.
4. Fall back to Twitter metadata, title, meta description and carefully selected HTML.
5. Introduce retailer-specific adapters only when needed and justified by testing.

Return normalized \`{title?, description?, imageUrl?, price?, currency?, sourceUrl, extractionStatus}\` where status may be \`success\`, \`partial\` or \`failed\`. Preserve the meaningful product-variation query parameters of links such as OTTO product URLs. Never hallucinate absent prices.

### 8.2 Security and reliability

- Protect against SSRF: block loopback, private, link-local, metadata-service and internal addresses; validate DNS and every redirect.
- Limit redirects, time, byte count and accepted content types; do not execute external JavaScript.
- Reject non-HTTP(S) protocols, malformed URLs and oversized payloads.
- Never forward cookies, user auth tokens or backend secrets to merchant sites.
- Apply rate limiting and log sanitized errors, not personal secrets.
- Support bot-blocked sites, malformed data, JavaScript-only pages and incomplete details gracefully.
- Do not require Playwright or a paid scraper in V1. Treat advanced extraction as a later enhancement.

### 8.3 Creation UX

The add-gift form starts with an optional link field and "Import details" action. A successful or partial response fills an editable form; failure leads to the same fully usable manual form. All fields are user-editable before save.

Price/currency formatting is locale-aware, but values are stored in the item's actual currency. Never imply continuously refreshed prices.

## 9. Internationalization — mandatory from Phase 1

Use **i18next + react-i18next** with JSON files:

\`\`\`text
src/i18n/index.ts
src/i18n/locales/en.json
src/i18n/locales/es.json
src/i18n/locales/de.json
\`\`\`

- **English is the default** on a browser with no previous selection (do not automatically override using browser language).
- Selector supports **English, Español, Deutsch** and is available on landing, login, owner pages and public/shared pages.
- Changing language updates rendered UI immediately without reload.
- Persist in localStorage under \`wishly:language\`; on unavailable storage, operate in English.
- Use \`useTranslation()\` inside React and a central translation function outside components; no custom i18n framework or mandatory HOCs.
- **No hardcoded user-facing strings** in components, hooks, toasts, errors, dialogs, aria labels, titles, validation text, loading or empty states. API errors use stable codes mapped to localized keys.
- Match translation key structure across all JSON files; CI fails on missing keys or mismatched interpolation placeholders.
- Use interpolation/plurals, not string concatenation.
- English is fallback for impossible/missing runtime keys, but CI should catch missing translations before deployment.
- Locale mapping: \`en -> en-GB\`, \`es -> es-ES\`, \`de -> de-DE\`.
- Use \`Intl.NumberFormat\` and \`Intl.DateTimeFormat\` for amounts, currencies and dates; switching locale never changes stored numerical values.
- Update \`document.documentElement.lang\`, page title and accessible text on language changes.
- Do **not** machine-translate wishlist titles, user descriptions or imported merchant text.

Example translation structure:

\`\`\`json
{
  "common": { "save": "Save", "cancel": "Cancel", "delete": "Delete" },
  "wishlist": { "create": "Create wishlist", "share": "Share wishlist" },
  "gift": { "add": "Add gift", "reserve": "I'll get this 🎁", "reservedByYou": "Reserved by you" },
  "errors": { "reservationConflict": "Someone has already reserved this gift." }
}
\`\`\`

Generate translated values for \`es.json\` and \`de.json\` from the start. Treat English as canonical for key authoring.

## 10. UX, visual language and accessibility

**Direction:** youthful and polished, but not childish; modern consumer product, visually clean, mobile-first, limited purposeful emojis, restrained accent (soft violet/indigo is a starting point), neutral background, rounded cards, generous whitespace, subtle motion and legible type (e.g. Inter or Geist).

**Screens/routes:**

| Route | Screen | Access |
| --- | --- | --- |
| \`/\` | Landing / primary create CTA | Public |
| \`/login\` | Google + magic link | Public |
| \`/auth/callback\` | Auth callback | Public |
| \`/dashboard\` | All creator wishlists | Authenticated |
| \`/wishlists/new\` | Create list | Authenticated |
| \`/wishlists/:id/edit\` | Edit list and gifts | Owner |
| \`/l/:shareToken\` | Read/reserve shared list | Anyone with token |
| \`*\` | Localized not found | Public |

**Core components:** \`WishlistCard\`, \`GiftCard\`, \`GiftForm\`, \`ProductImportForm\`, \`ReservationButton\`, \`ReservationBadge\`, \`ShareDialog\`, \`LanguageSelector\`, \`EmptyState\`, \`LoadingSkeleton\`, \`ErrorState\`, \`ConfirmDialog\`.

- Mobile: one-column layout; tablet: two; desktop: two/three as space allows.
- Comfortable from 320px width and touch targets around 44px or greater.
- Cover blank/new-user states, loading, errors, partial import, missing images, expired session, stale share links, disconnected realtime and confirmation for destructive actions.
- Semantic HTML, keyboard/focus management, accessible forms/dialogs, screen-reader status announcements, color contrast, reduced motion.
- Use normal React text escaping; don't inject untrusted product/user HTML.
- Unlisted pages use \`noindex\` and an appropriate strict referrer policy.

## 11. Suggested project organization

\`\`\`text
src/
  app/                 # router, providers, app shell
  components/ui/        # shadcn primitives and common UI
  components/layout/
  features/
    auth/
    wishlists/
    gifts/
    reservations/
    product-import/
  i18n/
    index.ts
    locales/en.json
    locales/es.json
    locales/de.json
  lib/
    supabase.ts
    api.ts
    validation.ts
    formatting.ts
  styles/
  types/
supabase/
  migrations/
  functions/
    public-wishlist/
    reservations/
    reservation-ownership/
    product-metadata/
tests/
  integration/
  e2e/
docs/
  IMPLEMENTATION_PLAN.md
AGENTS.md
\`\`\`

Prefer small, feature-oriented modules and explicit API types. Use TanStack Query for authoritative server state and React/local state for transient UI. Do not introduce Redux or other global state libraries without a concrete reason.

Suggested query keys: \`['my-wishlists', userId]\`, \`['wishlist', wishlistId]\`, \`['public-wishlist', shareToken]\`. Mutations invalidate relevant queries; Realtime messages trigger revalidation. Avoid showing irreversible optimistic success for reservations.

## 12. Testing and quality gates

**Unit:** parsing JSON-LD/OG and price normalization, URL safety validation, schema validation, localized formatting, translation interpolation, secret creation/hash normalization, status view-models.

**DB/RLS integration:** owner A cannot read/alter B's private data; anon cannot enumerate lists; all owner CRUD policies; share token rotation; cascade delete; reservation uniqueness; only matching proof can release; secret/hash never leaked; RPC grants remain minimal.

**E2E (Playwright isolated browser contexts):**

1. Google or magic-link creator logs in (test-friendly auth configuration); creates list and adds manual gift.
2. Creator imports product metadata and edits imported fields; extraction failure retains full manual entry.
3. Creator shares link; guest can view without logging in; unknown/rotated link fails.
4. Guest A reserves; guest B sees reserved via realtime; owner sees status.
5. Guest A refreshes and retains cancellation; guest B cannot cancel.
6. Two simultaneous reservations produce exactly one successful owner.
7. Guest goes offline, changes happen, then reconnect updates state accurately.
8. Owner deletes gift/list and guest receives updated state.
9. Switch en/es/de on every screen; selection persists across refresh; translated dates/currencies; creator data unaffected.
10. Unauthorized direct API attempts fail under actual RLS.
11. Mobile layouts, keyboard operation and basic accessibility checks succeed.

CI must run lint, formatting check, TypeScript, unit tests, translation parity, RLS/integration tests where feasible, and a production build. Use e2e on meaningful PR/release workflows. No skipped critical security tests without explanation.

## 13. Implementation phases and deliverables

Each phase must leave a testable, committed, documented state. Don't ask the agent to build everything in one uncontrolled pass.

| Phase | Scope | Deliverable |
| --- | --- | --- |
| 1 — Foundation + i18n | Vite/React/TS, routing, Tailwind/shadcn, Query, i18next, en/es/de JSON, locale selector, formatting, checks | Working localized app shell |
| 2 — Auth | Supabase project setup, Google OAuth, email magic link, callback, session, protected routes | Real creator authentication |
| 3 — Data + owner CRUD | Migrations, RLS, dashboard, lists, manual gifts, ownership tests | Creators manage multiple lists |
| 4 — Secure sharing | Random tokens, public read API, guest view, copy/regenerate, privacy guards | Unlisted public gift lists |
| 5 — Reservations | Guest secrets, atomic APIs, cancel/proof API, conflicts, concurrency tests | Correct anonymous reservations |
| 6 — Realtime | Triggered minimal events, subscriptions, refetch, reconnect and tab recovery | Live status on all viewers |
| 7 — Product import | Safe authenticated scraper, JSON-LD/OG, partial/manual form | Best-effort URL-based gift import |
| 8 — Polish/hardening | Responsive design, UX, accessibility, translations, security, e2e | Production-quality MVP |
| 9 — Deployment | CI, Cloudflare Pages, production Supabase, migrations/functions, environment docs, smoke tests | Repeatable live deployment |

When phase-dependent services require account setup, document exact manual steps and continue with all work that is possible without credentials.

## 14. Hosting and delivery

- Connect \`main\` to **Cloudflare Pages**: build \`npm run build\`, output \`dist\`; enable GitHub PR previews.
- Provide SPA fallback so directly opened \`/l/<token>\` and editor routes work.
- Use environment-separated Supabase configuration. Avoid sharing production secrets/data with untrusted previews.
- Frontend env: \`VITE_SUPABASE_URL\`, \`VITE_SUPABASE_PUBLISHABLE_KEY\` (not service-role).
- Backend secrets live only in trusted Supabase environments; configure via secure settings.
- Use Supabase CLI and version-controlled SQL migrations; deploy migrations **before** incompatible backend/frontend changes.
- Use GitHub Actions for checks and reproducible database/Edge Function deployment.
- Configure production and preview OAuth/magic-link redirect allowlists.
- Deploy over HTTPS and configure a custom domain later as needed.
- Log sanitized, actionable errors. Document backup/restore expectations and limits of free-tier availability.

Suggested release path: feature branch -> PR -> lint/typecheck/unit/translation/security tests -> preview -> review -> merge -> DB migrations -> Edge Functions -> frontend deployment -> smoke tests.

## 15. Failure handling and privacy

API errors should return stable codes (e.g. \`RESERVATION_CONFLICT\`, \`NOT_FOUND\`, \`UNAUTHORIZED\`, \`IMPORT_UNAVAILABLE\`) for translation in the UI.

Handle invalid URL, deleted/rotated list, blocked scraping, missing price/image, expired session, network timeouts, reservation conflict, storage failure, and reconnect. Do not show raw stack traces or database error details.

For an EU-facing service, provide clear privacy information about auth provider, stored list data, anonymous secret storage, infrastructure providers and retention. Avoid unnecessary analytics/trackers. No personal data in Realtime payloads; redact shared tokens and reservation secrets from logs where possible.

## 16. Out of scope in v1

Public list discovery, comments, gift quantities, priorities, collaborative editing, gift purchase/payment processing, price monitoring or alerts, affiliate networks, public profiles, AI gift suggestions, push notifications, native mobile apps, automatic translation of personal/product data and additional languages.

## 17. Definition of done

- [ ] Creator Google login and email magic link both work.
- [ ] Multiple lists per creator with working CRUD and ownership enforcement.
- [ ] Manual gift CRUD and best-effort URL import with editable/partial fallback.
- [ ] Unique unlisted share links can be copied and rotated; no public enumeration.
- [ ] Anonymous guests can browse and reserve without sign-in.
- [ ] Reservation secrets are not exposed; only owning browser can cancel.
- [ ] A server-verified ownership proof distinguishes "mine" after refresh.
- [ ] Concurrent reservations cannot produce two successful gift claims.
- [ ] Gift and reservation changes synchronize; reconnect restores truth.
- [ ] English default, Spanish and German selectable locally on every page.
- [ ] JSON-driven translations for **all** user-facing app strings; parity checked in CI.
- [ ] Correct currency/date formatting without translating user-generated content.
- [ ] Responsive and accessible interface with meaningful empty/loading/error states.
- [ ] RLS, public read controls, SSRF protections and secrets reviewed and tested.
- [ ] Production build, migration/function deployments, HTTPS, GitHub-connected Cloudflare deployment work.
- [ ] README explains setup, required manual provider configuration, development, tests, deploy and known anonymous reservation limitations.

## 18. Operating instructions for coding agents

Read [AGENTS.md](../AGENTS.md) before writing code. Use this plan as requirements authority, while checking vendor APIs against current official docs and documenting justified deviations.

Begin with a concise feasibility/security review and implementation checklist. Work **one phase at a time**, run real validation, keep changes small, and report completed/blocked items. Do not silently skip features, fake successful tests, bypass RLS or ship placeholder security logic. The repository may initially contain only a \`.gitignore\`; initialize the project in Phase 1.
