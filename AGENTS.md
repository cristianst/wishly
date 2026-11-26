# AGENTS.md — Wishly Coding Agent Instructions

These instructions apply to every coding agent working in this repository. Read this file and [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) before making changes.

## Purpose

Build **Wishly**, a modern mobile-first wishlist app. Creators log in with Google or email magic links, create multiple unlisted wishlists, and share them by URL. Anonymous guests can reserve gifts; other viewers see availability live. Gift metadata may be extracted from merchant links, with an editable manual fallback. The UI supports **English (default), Spanish and German**, selected locally.

The implementation plan is the requirements source of truth. This file defines how to implement and verify those requirements. If requirements conflict with a technical limitation, explain the issue and document a safe change instead of quietly weakening functionality.

## Required stack

- React, Vite, TypeScript (strict mode)
- React Router, TanStack Query
- Tailwind CSS, shadcn/ui, Lucide React
- React Hook Form and Zod
- i18next and react-i18next, JSON locales
- Supabase PostgreSQL, Auth, Edge Functions, Realtime Broadcast
- Cloudflare Pages, GitHub-based CI/CD
- Vitest, React Testing Library, Playwright, Supabase database/RLS tests

Use current, supported library versions compatible with each other. Supabase Edge Functions run in a Deno-compatible runtime; do not assume a Node-only scraper library works there. Avoid new dependencies and abstraction layers unless justified.

## Absolute rules

1. **No hardcoded user-facing strings.** Every label, validation error, toast, page title, dialog, tooltip, loading/empty state and accessibility label must be localized using JSON keys in all three locale files. This includes server error presentation.
2. **English is the default** unless this browser previously selected another language. Use localStorage key \`wishly:language\`; do not automatically override based on browser locale. Language changes update the UI without reload.
3. **Server is authoritative.** PostgreSQL stores wishlists, gifts and reservations. Do not rely on localStorage for shared reservation status.
4. **RLS is mandatory** for all application tables. Owner permissions and public guest permissions are fundamentally different.
5. **No service-role/secret key in the browser.** Only expose permitted publishable Supabase config. Privileged work belongs on the server.
6. **No anonymous guest signup required.** A browser-held cryptographically random reservation secret proves cancellation rights. Store only its SHA-256 hash in the DB.
7. **No race-prone reservations.** Enforce UNIQUE(item_id) and atomic server-side insert/delete; prove with concurrency tests.
8. **Do not trust Realtime messages** to mutate authoritative state. Treat as cache invalidation; refetch sanitized server data.
9. **No unrestricted public database read.** Guest access to unlisted wishlists goes through a controlled read endpoint keyed by a sufficiently random sharing capability.
10. **Product import must never block manual creation.** Missing fields are nullable/editable; never invent prices.
11. **Product URL extraction must be SSRF-safe.** Validate URL, DNS/redirects, private-address exclusions, timeouts, content-type and response size.
12. **No fake completions.** Never claim a test, deployment, provider connection or auth flow works unless it has actually been verified.
13. **No scope creep.** Do not add social feeds, payments, quantities, wish comments, pricing trackers or AI features for MVP.
14. **No user secrets in logs, events, URLs or commits.** Redact share and claim tokens where possible. Use HTTPS and a strict referrer policy on shared pages.

## Internationalization checklist

- Resources: \`src/i18n/locales/en.json\`, \`es.json\`, \`de.json\`.
- Translate through \`useTranslation()\` inside React and a central translation helper outside components.
- Keep identical key trees and compatible interpolation/pluralization keys.
- Include locale parity checks in CI. Fail for missing keys.
- Map locales to \`en-GB\`, \`es-ES\`, \`de-DE\`; use \`Intl\` for amounts/dates.
- Change \`document.documentElement.lang\`, localized document titles and aria labels on locale change.
- Never machine-translate user-entered or merchant-provided wishlist/gift content.

## Security-critical flows

### Public list

- Creator gets an unguessable share token (>=128 bits entropy; 256 preferred).
- A public Edge Function resolves this token and returns **sanitized** list/items and boolean reservation status only.
- Rotating the token invalidates the old URL. Apply \`noindex\` and \`Referrer-Policy: no-referrer\`.
- Never expose creator email, claim-token digest, secret, sensitive internal fields or publicly enumerable records.

### Reserve and cancel

- Browser makes a random 256-bit claim secret per reservation.
- Preserve the pending secret in \`localStorage\` before issuing the request.
- Server hashes claim secret and creates reservation atomically.
- \`UNIQUE(item_id)\` ensures only one active reservation per gift.
- Identical secret retry should be idempotent.
- Only a matching secret can cancel.
- Verify "reserved by you" **server-side** using a secret proof; a stale localStorage entry alone is not ownership.
- Handle disconnected clients, retries, expired/missing items, other-guest conflicts and missing localStorage.
- Do not let a guest cancel another guest's reservation.

### Realtime

- Broadcast minimal change notifications, not raw records.
- Join only the relevant wishlist topic.
- Refetch after event, reconnect, focus and confirmed mutations.
- Account for duplicate/spurious/out-of-order notifications.
- Treat public channel messages as untrusted hints.

## UI and product quality

Aim for a polished, youthful, minimalist consumer app: mobile first, soft neutrals, restrained violet/indigo accents, readable modern type, whitespace, rounded gift cards, subtle feedback, purposeful emojis. Avoid childish overload or a generic admin-panel aesthetic.

Build the landing, login, owner dashboard, list editor, add/edit gift form, public wishlist and error/not-found states. Include accessible labels, keyboard/focus behavior, reduced-motion support, responsive layouts down to ~320px and touch targets around 44px.

Public guest actions should be immediately understandable: "I'll get this 🎁", "Reserved by you", "Cancel reservation", "Already reserved" — all via translation keys.

## Code organization and conventions

Suggested structure:

\`\`\`text
src/
  app/
  components/ui/
  components/layout/
  features/{auth,wishlists,gifts,reservations,product-import}/
  i18n/{index.ts,locales/{en,es,de}.json}
  lib/{supabase,api,validation,formatting}.ts
  styles/
  types/
supabase/
  migrations/
  functions/{public-wishlist,reservations,reservation-ownership,product-metadata}/
tests/{integration,e2e}/
docs/IMPLEMENTATION_PLAN.md
AGENTS.md
\`\`\`

- Prefer feature-owned code and small focused functions.
- Type API responses and schemas; validate untrusted boundaries with Zod or equivalent.
- Keep database schema and functions in version-controlled migrations.
- Do not duplicate derivable reservation state in separate mutable columns.
- Separate UI state, query cache and local browser preferences.
- Use small, readable changes rather than giant unreviewable rewrites.
- Keep Git changes scoped to the task. Avoid formatting unrelated files.
- Maintain documentation for environment setup, manual OAuth steps and deployment.

## Workflow for agents

1. Inspect the repository; do not assume application files already exist.
2. Read this file and the full implementation plan.
3. Before implementation, summarize the current phase, dependencies, security considerations and intended files.
4. Complete **one implementation phase at a time** following the plan:
   - Phase 1: foundation and three-language i18n
   - Phase 2: creator authentication
   - Phase 3: schema/RLS and owner list/gift CRUD
   - Phase 4: unlisted public sharing
   - Phase 5: secure anonymous reservations
   - Phase 6: Realtime synchronization
   - Phase 7: best-effort product metadata importing
   - Phase 8: UX, accessibility and security polish
   - Phase 9: CI/CD and production deployment
5. Validate every phase with appropriate commands; at minimum lint, typecheck, unit tests and production build once configured. Use real database integration tests for RLS/reservations.
6. Add/update tests whenever behavior changes. For security-sensitive code, include negative and race tests.
7. Report implemented functionality, exact checks run, failed/blocking checks, and any known limitations.
8. Commit working changes by phase when authorized, with descriptive commit messages.
9. If credentials or external configuration are unavailable, clearly list manual prerequisites, implement what is possible locally, and never claim live integration is already configured.

## Definition of done for any task

- Changes meet their acceptance criteria from the plan.
- EN/ES/DE translations are complete for any new UI strings.
- Appropriate error/empty/loading states exist.
- Authorization and input validation are not bypassed.
- Relevant tests were run or limitations explicitly documented.
- Builds, lint/typecheck and migration checks pass where configured.
- No secrets or accidental debug data are committed.
- Any deviation from the approved plan is explicitly described.

## Release expectations

Cloudflare Pages builds \`npm run build\` and serves \`dist\`. Configure SPA fallback, pull-request previews and automatic production builds from \`main\`.

Supabase schema migrations and Edge Functions deploy through repeatable CLI/CI steps. Use separate production and preview environments when practical; apply backward-compatible migrations before deploying dependent code. Never publish privileged keys or point untrusted previews at a production service-role key.

**Important:** This repository starts as a planning handoff. Do **not** begin implementing the app until the user explicitly requests implementation. For a planning-only task, editing documentation and agent instructions is permitted, but creating production application code is not.
