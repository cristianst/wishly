// Post-deployment smoke tests. Read-only, no credentials: they check that the site and the public
// Edge Functions are up and answer with the security behaviour we rely on.
//
//   SITE_URL=https://wishly.example SUPABASE_URL=https://<ref>.supabase.co node scripts/smoke-test.ts
//
// SITE_URL is optional (skips the site checks); SUPABASE_URL is required for the function checks.

export interface SmokeConfig {
  siteUrl?: string
  supabaseUrl?: string
}

export interface CheckResult {
  name: string
  ok: boolean
  detail: string
}

type Fetch = typeof fetch

const UNKNOWN_TOKEN = 'z'.repeat(64)
const SOME_UUID = '3f2b8f4e-6a1c-4d2e-9b7a-1c2d3e4f5a6b'
const SOME_SECRET = 'S'.repeat(43)

async function get(fetchImpl: Fetch, url: string, init: RequestInit = {}) {
  return fetchImpl(url, { ...init, signal: AbortSignal.timeout(20_000), redirect: 'manual' })
}

const jsonPost = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

async function check(name: string, run: () => Promise<string | null>): Promise<CheckResult> {
  try {
    const problem = await run()
    return { name, ok: problem === null, detail: problem ?? 'ok' }
  } catch (error) {
    return {
      name,
      ok: false,
      detail: `request failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

const expect = (condition: boolean, message: string): string | null => (condition ? null : message)

export async function runChecks(
  config: SmokeConfig,
  fetchImpl: Fetch = fetch,
): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  const site = config.siteUrl?.replace(/\/$/, '')
  const api = config.supabaseUrl?.replace(/\/$/, '')

  if (site) {
    results.push(
      await check('site: home page is served with a strict CSP', async () => {
        const response = await get(fetchImpl, `${site}/`)
        const csp = response.headers.get('content-security-policy') ?? ''
        return (
          expect(response.status === 200, `expected 200, got ${response.status}`) ??
          expect(/text\/html/.test(response.headers.get('content-type') ?? ''), 'not HTML') ??
          expect(
            csp.includes("script-src 'self'") && !csp.includes('unsafe-eval'),
            'CSP missing or too loose',
          ) ??
          expect(response.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options is not DENY')
        )
      }),
      await check('site: deep links fall back to the app (SPA routing)', async () => {
        const response = await get(fetchImpl, `${site}/login`)
        return expect(response.status === 200, `expected 200 for /login, got ${response.status}`)
      }),
      await check('site: shared links are private (noindex, no referrer, no cache)', async () => {
        const response = await get(fetchImpl, `${site}/l/${UNKNOWN_TOKEN}`)
        return (
          expect(response.status === 200, `expected 200, got ${response.status}`) ??
          expect(
            (response.headers.get('x-robots-tag') ?? '').includes('noindex'),
            'missing noindex',
          ) ??
          expect(
            response.headers.get('referrer-policy') === 'no-referrer',
            'referrer policy is not no-referrer',
          ) ??
          expect(response.headers.get('cache-control') === 'no-store', 'shared page is cacheable')
        )
      }),
    )
  }

  if (api) {
    const fn = (name: string) => `${api}/functions/v1/${name}`
    results.push(
      await check('public-wishlist: unknown or rotated link is a plain 404', async () => {
        const response = await get(
          fetchImpl,
          fn('public-wishlist'),
          jsonPost({ token: UNKNOWN_TOKEN }),
        )
        const body: unknown = await response.json().catch(() => null)
        return (
          expect(response.status === 404, `expected 404, got ${response.status}`) ??
          expect(
            JSON.stringify(body) === '{"error":{"code":"NOT_FOUND"}}',
            `unexpected body ${JSON.stringify(body)}`,
          ) ??
          expect(response.headers.get('cache-control') === 'no-store', 'response is cacheable')
        )
      }),
      await check('public-wishlist: CORS preflight is answered', async () => {
        const response = await get(fetchImpl, fn('public-wishlist'), { method: 'OPTIONS' })
        return expect(response.status === 204, `expected 204, got ${response.status}`)
      }),
      await check('reservations: rejects unsupported methods', async () => {
        const response = await get(fetchImpl, fn('reservations'))
        return expect(response.status === 405, `expected 405, got ${response.status}`)
      }),
      await check('reservations: unknown list cannot be reserved on', async () => {
        const response = await get(
          fetchImpl,
          fn('reservations'),
          jsonPost({
            shareToken: UNKNOWN_TOKEN,
            itemId: SOME_UUID,
            reservationSecret: SOME_SECRET,
          }),
        )
        return expect(response.status === 404, `expected 404, got ${response.status}`)
      }),
      await check('reservation-ownership: empty batch is answered without error', async () => {
        const response = await get(
          fetchImpl,
          fn('reservation-ownership'),
          jsonPost({ shareToken: UNKNOWN_TOKEN, proofs: [] }),
        )
        const body: unknown = await response.json().catch(() => null)
        return (
          expect(response.status === 200, `expected 200, got ${response.status}`) ??
          expect(
            JSON.stringify(body) === '{"ownedItemIds":[]}',
            `unexpected body ${JSON.stringify(body)}`,
          )
        )
      }),
      await check('product-metadata: refuses callers who are not signed in', async () => {
        const response = await get(
          fetchImpl,
          fn('product-metadata'),
          jsonPost({ url: 'https://example.com/' }),
        )
        return expect(response.status === 401, `expected 401, got ${response.status}`)
      }),
    )
  }

  if (results.length === 0) {
    results.push({ name: 'configuration', ok: false, detail: 'set SITE_URL and/or SUPABASE_URL' })
  }
  return results
}

export function summarize(results: CheckResult[]): { text: string; failed: number } {
  const lines = results.map(
    (r) => `${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : `\n      -> ${r.detail}`}`,
  )
  const failed = results.filter((r) => !r.ok).length
  return {
    text: [
      ...lines,
      '',
      failed === 0
        ? `All ${results.length} smoke checks passed.`
        : `${failed} of ${results.length} smoke checks FAILED.`,
    ].join('\n'),
    failed,
  }
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { text, failed } = summarize(
    await runChecks({ siteUrl: process.env.SITE_URL, supabaseUrl: process.env.SUPABASE_URL }),
  )
  console.log(text)
  process.exit(failed === 0 ? 0 : 1)
}
