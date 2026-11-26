# Wishly 🎁

A mobile-first gift wishlist app. Creators sign in (Google or an email link), build any number of
wishlists and share each one by an unlisted link. Guests open the link **without an account** and reserve a
gift so nobody buys the same thing twice. Gift details can be imported from a product link, with a manual
fallback. The interface is available in **English (default), Spanish and German**.

- Requirements and decisions: [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) · agent rules: [`AGENTS.md`](AGENTS.md)
- Environment and provider setup: [`docs/SETUP.md`](docs/SETUP.md)
- Releasing to production: [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

## Stack

React 19 · Vite · TypeScript (strict) · React Router · TanStack Query · Tailwind CSS 4 · Radix UI ·
React Hook Form + Zod · i18next — backed by **Supabase** (PostgreSQL with RLS, Auth, Edge Functions) and
hosted on **Cloudflare Pages**. There is no custom always-on backend.

## Quick start

Requires Node 22.12+ (CI uses Node 24, see `.nvmrc`). Docker is needed only for the database tests.

```bash
npm install
cp .env.example .env.local     # then add your Supabase URL and PUBLISHABLE key (never a secret key)
npm run dev                    # http://localhost:5173
```

Without Supabase values the app still runs; the login page says sign-in is not configured.
Creating a Supabase project, applying the migrations, deploying the Edge Functions and configuring Google
sign-in are manual steps: see [`docs/SETUP.md`](docs/SETUP.md).

## Scripts

| Command                                       | What it does                                                                                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev` / `build` / `preview`           | Dev server, production build (`dist/`), preview the build                                                                                     |
| `npm run lint` · `format:check` · `typecheck` | ESLint, Prettier, TypeScript (strict)                                                                                                         |
| `npm test`                                    | Unit, component, accessibility (axe, EN/ES/DE), Edge Function and locale-parity tests                                                         |
| `npm run test:db`                             | Applies the real migrations to a throwaway PostgreSQL container and tests RLS, then races 24 parallel connections for one gift (needs Docker) |
| `node scripts/smoke-test.ts`                  | Read-only post-deploy checks (`SITE_URL`, `SUPABASE_URL`)                                                                                     |
| `node scripts/check-bundle-secrets.ts dist`   | Fails if a Supabase secret key is in the browser bundle                                                                                       |

## Project layout

```text
src/
  app/             router, providers
  components/      layout shell, UI primitives (shadcn-style), dialogs, states
  features/        auth · wishlists · gifts · public (guest page) · reservations · product-import · legal
  i18n/locales/    en.json · es.json · de.json   (CI fails on missing keys or placeholders)
  lib/             API errors, formatting, validation, polling, Supabase client
supabase/
  migrations/      schema, RLS, sharing, reservations (version-controlled SQL)
  functions/       public-wishlist · reservations · reservation-ownership · product-metadata
  templates/       branded EN/ES/DE auth emails (need custom SMTP to take effect)
tests/             database/RLS, Edge Function, security-header and CI-script tests
.github/workflows/ ci · deploy
```

## How it works (and what it deliberately does not do)

- **Authorization lives in the database.** Every table has row-level security; clients get column-level grants
  and cannot set `share_token` or `owner_id`. Guests never touch tables: they call Edge Functions that use
  locked-down SQL functions.
- **Share links are capabilities.** 244 bits of randomness, hidden from search engines, never cached, and sent
  with `Referrer-Policy: no-referrer`. Creating a new link instantly invalidates the old one.
- **Anonymous reservations.** The browser creates a random 256-bit secret and keeps it in `localStorage`; only
  its SHA-256 hash is stored. `UNIQUE(item_id)` makes reserving race-free. "Reserved by you" is verified by the
  server, never inferred from local storage.
- **Pages stay current** with a quiet 30-second refresh (no Realtime — see `docs/SETUP.md`).
- **Product import is best-effort.** It reads schema.org / Open Graph data, is SSRF-hardened, never guesses prices,
  and does not pretend to be a browser. Shops that block automated requests (e.g. OTTO, adidas) fall back to manual entry.

### Known limitations (by design for the MVP)

- **Reservations belong to a browser.** Clearing site data or switching device means the guest can no longer
  cancel their reservation themselves (the list owner can still delete the gift). The app warns if storage is blocked.
- One owner per list, one reservation per gift, no quantities, no price tracking, no collaboration.
- Guests are anonymous: owners see _that_ a gift is reserved, never by whom.
- No self-service account deletion yet (the privacy page says so; contact the operator).
- Imported prices are a snapshot, not live prices. Content you type is never machine-translated.

## Quality gates

CI (`.github/workflows/ci.yml`) runs: dependency audit, lint, format, typecheck, all tests, production build, a
secret-key scan of the bundle, the database/RLS/race tests, and a Deno type check of every Edge Function.
Production deploys only from `main` after CI passes — see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
