# Deploying Wishly

There is **one environment: production** (no staging, no pull-request previews). Release path: **pull request → CI → review → merge to `main` → approval → database migrations → Edge Functions → frontend → smoke tests.**
Migrations are backward-compatible and run *before* the code that needs them. The whole sequence is one workflow
(`.github/workflows/deploy.yml`), so ordering is guaranteed.

> Nothing here has been run against a real GitHub repository or Cloudflare account yet; those need the one-time
> setup below. The Supabase steps mirror commands that were run by hand against the production project.

## One-time setup (do this before the first deploy)

Work through the four parts in order. Everything below is a manual step in a dashboard; none of it can be done from
the repository. Dashboard labels change now and then, so treat the paths as a guide.

### The values you will collect

Keep a scratch note while you go. By the end you need all of these, which then go into the GitHub **`production`
environment** (part 4).

| # | Value | Where you get it | Goes into GitHub as |
| --- | --- | --- | --- |
| 1 | Supabase **project ref** (a short id such as `abcdefghijklmnop`) | Supabase → Project Settings → General → *Reference ID* (it is also the first part of your project URL) | variable `SUPABASE_PROJECT_REF` |
| 2 | Supabase **project URL** (`https://<ref>.supabase.co`) | Supabase → Project Settings → API | variable `VITE_SUPABASE_URL` |
| 3 | Supabase **publishable key** (`sb_publishable_…`) | Supabase → Project Settings → API Keys. **Never** the secret / `service_role` key | variable `VITE_SUPABASE_PUBLISHABLE_KEY` |
| 4 | Supabase **access token** | Supabase → Account (avatar) → Access Tokens → *Generate new token* (name it `github-actions`) | secret `SUPABASE_ACCESS_TOKEN` |
| 5 | Supabase **database password** | the one you chose when creating the project; otherwise Project Settings → Database → *Reset database password* | secret `SUPABASE_DB_PASSWORD` |
| 6 | Cloudflare **account ID** | Cloudflare dashboard → Workers & Pages (shown in the right-hand column) | variable `CLOUDFLARE_ACCOUNT_ID` |
| 7 | Cloudflare **Pages project name** | the name you give the project in part 3 | variable `CLOUDFLARE_PAGES_PROJECT` |
| 8 | Cloudflare **API token** | Cloudflare → My Profile → API Tokens (part 3) | secret `CLOUDFLARE_API_TOKEN` |
| 9 | Your **site address** (`https://your-domain` or the `*.pages.dev` address) | decided in part 3 | variable `SITE_URL` |

Three of these are secrets (4, 5, 8): paste them once into GitHub and do not store them anywhere else.

### Part 1 · GitHub

1. **Repository location.** It must live in an allowed organisation (Haiilo GitHub / coyoapp GitLab). The `origin` this
   project was developed with is a personal account and **must not be used for deployment**. Move or re-create the
   repository first, then push the branch.
2. **Allow the actions the workflows use** (Settings → Actions → General): GitHub's own actions plus
   `cloudflare/wrangler-action` and `denoland/setup-deno`. Keep *Workflow permissions* on **read-only**; the workflows
   ask for nothing more. If your organisation restricts third-party actions, get these two approved first.
3. **Protect `main`** (Settings → Branches / Rulesets): require a pull request, at least one approval, and the CI
   status checks. The check names appear after CI has run once on a pull request: *Lint, types, tests, build*,
   *Database (RLS policies and reservation races)* and *Edge Functions (Deno type check)*. Work happens on branches
   (`feature/…`, `fix/…`) and is merged by pull request; **only a merge to `main` deploys**.
4. **Create the `production` environment** (Settings → Environments → *New environment*):
   - *Required reviewers*: add yourself or the people allowed to release, so every release waits for a click before it
     changes anything live.
   - *Deployment branches and tags*: **Selected** → allow `main` and tags only, so no other branch can use the
     production secrets even if a workflow file were edited.
   - Add the secrets and variables from the table above (part 4).
5. Dependabot is already configured (`.github/dependabot.yml`); make sure Dependabot is enabled for the repository.

### Part 2 · Supabase (the production project you already have)

Do these *before* the first release so sign-in works for real users:

1. **Collect values 1–5** from the table above.
   - The access token acts with the **same rights as your Supabase user**, across every project you can access. If
     that is too broad, create a dedicated Supabase account for CI and invite it to the organisation with access to
     this project only, then generate the token there.
   - Resetting the database password disconnects anything using the old one; do it deliberately, not mid-release.
2. **Auth → URL Configuration**: set the *Site URL* to your production address, and add `https://your-domain/auth/callback`
   to the *Redirect URLs*. (Add `http://localhost:5173/auth/callback` too if you sign in locally against this project.)
3. **Custom SMTP** (Project Settings → Authentication → SMTP). Needed before real users sign up: the built-in mailer is
   heavily rate-limited, only delivers to team members, and blocks editing the email templates. Prepare an account with
   an email provider and a verified sender domain. Afterwards paste `supabase/templates/*` into Authentication → Emails.
4. **Google sign-in**: in Google Cloud Console create an OAuth client (*Web application*), add the authorised redirect URI
   `https://<ref>.supabase.co/auth/v1/callback`, then paste the client ID and secret into Supabase → Authentication →
   Providers → Google. Publish your OAuth consent screen: Google only lets arbitrary users sign in once it is published.
5. **Nothing to configure for the Edge Functions**: `SUPABASE_URL`, the anon key and the service-role key are injected
   automatically, and the workflow deploys all four functions. Never copy the service-role key anywhere.
6. **Check the starting point** (optional, read-only): `npx supabase migration list --remote` should show every local
   migration also applied remotely. If a migration was pasted into the SQL Editor earlier, mark it as applied with
   `npx supabase migration repair --remote --status applied <version>`, or the first deploy will try to run it again.

### Part 3 · Cloudflare Pages

1. **Create the project with Direct Upload** (Workers & Pages → Create → Pages → *Upload assets*), not by connecting
   Git. The GitHub workflow uploads the build itself, which is what guarantees the order *migrations → functions →
   frontend*. Name it (value 7) and make `main` the **production branch**. The first upload can be any build: run
   `npm run build` and drag `dist/` in. (A project created as Direct Upload cannot be switched to Git later; that is fine.)
2. **Create the API token** (My Profile → API Tokens → *Create Token* → *Create Custom Token*). Give it one permission,
   **Account → Cloudflare Pages → Edit**, restricted to your account. Copy it once (value 8).
3. **Note the account ID** (value 6).
4. **Custom domain** (optional but recommended): Pages project → Custom domains → add it; HTTPS is automatic. This is your
   site address (value 9). Without one you can use the `https://<project>.pages.dev` address. Whichever you choose, it
   must be the origin you put in Supabase's redirect list in part 2.
5. Nothing else to configure: `public/_headers` (security headers, caching) and `public/_redirects` (so direct links
   like `/l/<token>` open the app) are part of the build. If you ever use a custom Supabase domain, add it to
   `connect-src` in `public/_headers`.

### Part 4 · Put the values into GitHub

In Settings → Environments → **production**:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `SUPABASE_ACCESS_TOKEN` | value 4 |
| Secret | `SUPABASE_DB_PASSWORD` | value 5 |
| Secret | `CLOUDFLARE_API_TOKEN` | value 8 |
| Variable | `SUPABASE_PROJECT_REF` | value 1 |
| Variable | `VITE_SUPABASE_URL` | value 2 |
| Variable | `VITE_SUPABASE_PUBLISHABLE_KEY` | value 3 (**publishable** key only) |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | value 6 |
| Variable | `CLOUDFLARE_PAGES_PROJECT` | value 7 |
| Variable | `SITE_URL` | value 9 |

The `VITE_` values are baked into the build, so they must be the production project's **publishable** values. Variables
are visible to people who can edit the repository; secrets are write-only. A secret or service-role key must never be
put in a `VITE_` variable: CI scans the bundle and fails the build if one gets in.

### Before the first release: quick checklist

- [ ] Repository is in the allowed organisation and the branch is pushed there.
- [ ] The two third-party actions are allowed; workflow permissions are read-only.
- [ ] `main` is protected; the `production` environment has reviewers and *deployment branches = main and tags*.
- [ ] Values 1–9 collected; all nine are set in the `production` environment (three secrets, six variables).
- [ ] Supabase: Site URL and redirect URL set; custom SMTP, Google sign-in and email templates done.
- [ ] Cloudflare: Direct Upload project exists with production branch `main`; token has only *Pages: Edit*.
- [ ] Open a small pull request first: CI should go green on GitHub. Then merge it: the **Deploy** run pauses for your
      approval, then ships. Check the smoke-test step at the end.

### No staging, no previews (deliberate)

To keep things simple there is a single live environment, so migrations and functions go straight to production.
That is why the release has several safety nets instead: everything must pass CI first (including the real-Postgres
RLS and race tests, which run against a throwaway database, not production), the **dry-run** shows pending migrations
before they are applied, the `production` environment can require a human approval, smoke tests run right after, and
rollback is quick (see below). If this ever becomes too risky, add a second Supabase project and a preview workflow;
the plan describes both.

## Releasing

1. Open a pull request. CI must pass; review and merge.
2. Merging to `main` starts **Deploy**: CI again → *dry-run* of pending migrations → apply migrations → deploy all
   Edge Functions → build → upload to Cloudflare Pages → smoke tests. A required-reviewer gate on `production` pauses
   it before anything changes.
3. Check the smoke-test output in the run log. You can also run them by hand:

   ```bash
   SITE_URL=https://your-domain SUPABASE_URL=https://<ref>.supabase.co node scripts/smoke-test.ts
   ```

### Writing migrations safely

Apply the *expand → deploy → contract* pattern: add columns/tables/functions first (old code keeps working), ship the
code that uses them, and only drop or rename things in a later release. Never edit a migration that has already been
applied; add a new one. Never mutate production data by hand: use a migration.

### If something goes wrong

- **Frontend bug:** Cloudflare Pages → Deployments → *Rollback* to the previous deployment (instant), or run **Deploy**
  manually (`workflow_dispatch`) on an older tag.
- **Edge Function bug:** re-run **Deploy** on the previous good tag; functions are redeployed in full.
- **Migration problem:** migrations are forward-only. Fix by adding a corrective migration. This is why destructive
  changes are delayed to a later release.
- **Deploy failed half-way:** it is safe to re-run. Applied migrations are skipped, functions are redeployed, and the
  frontend upload is idempotent.

## Operations

- **Backups:** check your Supabase plan. Daily backups and point-in-time recovery depend on the plan and are not
  guaranteed on the free tier. For anything you cannot lose, schedule `npx supabase db dump` (to encrypted storage you
  control) and test a restore. Free projects can also be paused after a period of inactivity.
- **Logs:** Edge Functions log only reason codes, never URLs, tokens, secrets or emails. Supabase retains logs for a
  limited time that depends on the plan.
- **Rate limits** are stored in the database (`rate_limits`) and cleaned up opportunistically.
- **Free-tier limits** (Edge Function invocations, database size, Cloudflare build/deploy quotas) change over time;
  check the current plans before launch.

## Before you announce it (privacy and security checklist)

- [ ] Custom SMTP configured and the auth email templates pasted in.
- [ ] Google OAuth consent screen published; production redirect URIs added.
- [ ] `VITE_CONTACT_EMAIL` set and the **privacy page reviewed by someone qualified** (it is a draft written from how the
      app works; it is not legal advice). It names Supabase, Cloudflare, Google and the SMTP provider; update it if you
      add or change providers or the data region.
- [ ] A way to honour deletion requests (there is no self-service account deletion yet).
- [ ] Supabase dashboard shows **RLS enabled** on `wishlists`, `wishlist_items`, `reservations`, `rate_limits`.
- [ ] Smoke tests pass against the real domain; open a shared link in a private window and reserve a gift from two browsers.
- [ ] Branch protection and the `production` approval gate are on.
