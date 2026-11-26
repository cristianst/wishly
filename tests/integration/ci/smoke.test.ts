import { runChecks, summarize } from '../../../scripts/smoke-test'

const CSP = "default-src 'self'; script-src 'self'; frame-ancestors 'none'"

/** A fake deployment that behaves correctly; individual tests break one thing at a time. */
function healthy(overrides: Record<string, () => Response> = {}): typeof fetch {
  const routes: Record<string, () => Response> = {
    'GET https://site.test/': () =>
      new Response('<html></html>', {
        headers: {
          'content-type': 'text/html',
          'content-security-policy': CSP,
          'x-frame-options': 'DENY',
        },
      }),
    'GET https://site.test/login': () =>
      new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
    [`GET https://site.test/l/${'z'.repeat(64)}`]: () =>
      new Response('<html></html>', {
        headers: {
          'x-robots-tag': 'noindex, nofollow',
          'referrer-policy': 'no-referrer',
          'cache-control': 'no-store',
        },
      }),
    'POST https://api.test/functions/v1/public-wishlist': () =>
      new Response('{"error":{"code":"NOT_FOUND"}}', {
        status: 404,
        headers: { 'cache-control': 'no-store' },
      }),
    'OPTIONS https://api.test/functions/v1/public-wishlist': () =>
      new Response(null, { status: 204 }),
    'GET https://api.test/functions/v1/reservations': () => new Response('{}', { status: 405 }),
    'POST https://api.test/functions/v1/reservations': () => new Response('{}', { status: 404 }),
    'POST https://api.test/functions/v1/reservation-ownership': () =>
      new Response('{"ownedItemIds":[]}', { status: 200 }),
    'POST https://api.test/functions/v1/product-metadata': () =>
      new Response('{}', { status: 401 }),
    ...overrides,
  }
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`
    const route = routes[key]
    if (!route) throw new Error(`unexpected request: ${key}`)
    return route()
  }) as typeof fetch
}

const config = { siteUrl: 'https://site.test', supabaseUrl: 'https://api.test' }

describe('smoke test script', () => {
  it('passes against a correctly behaving deployment', async () => {
    const results = await runChecks(config, healthy())
    expect(results.filter((r) => !r.ok)).toEqual([])
    expect(results.length).toBe(9)
    expect(summarize(results).failed).toBe(0)
  })

  it('can run for the backend only, or the site only', async () => {
    expect((await runChecks({ supabaseUrl: 'https://api.test' }, healthy())).length).toBe(6)
    expect((await runChecks({ siteUrl: 'https://site.test' }, healthy())).length).toBe(3)
  })

  it('refuses to pass when nothing is configured', async () => {
    const results = await runChecks({}, healthy())
    expect(results).toEqual([
      { name: 'configuration', ok: false, detail: 'set SITE_URL and/or SUPABASE_URL' },
    ])
  })

  it.each([
    [
      'a missing CSP',
      'GET https://site.test/',
      () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } }),
      'site: home page',
    ],
    [
      'an unsafe CSP',
      'GET https://site.test/',
      () =>
        new Response('<html></html>', {
          headers: {
            'content-type': 'text/html',
            'content-security-policy': "script-src 'self' 'unsafe-eval'",
            'x-frame-options': 'DENY',
          },
        }),
      'site: home page',
    ],
    [
      'a broken deep link',
      'GET https://site.test/login',
      () => new Response('nope', { status: 404 }),
      'deep links',
    ],
    [
      'a shared page that can be indexed',
      `GET https://site.test/l/${'z'.repeat(64)}`,
      () =>
        new Response('<html></html>', {
          headers: { 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' },
        }),
      'shared links are private',
    ],
    [
      'a public function that leaks data for an unknown token',
      'POST https://api.test/functions/v1/public-wishlist',
      () => new Response('{"wishlist":{"title":"x"}}', { status: 200 }),
      'public-wishlist: unknown',
    ],
    [
      'a reservation endpoint that accepts GET',
      'GET https://api.test/functions/v1/reservations',
      () => new Response('{}', { status: 200 }),
      'reservations: rejects',
    ],
    [
      'product import open to anonymous callers',
      'POST https://api.test/functions/v1/product-metadata',
      () => new Response('{"title":"x"}', { status: 200 }),
      'product-metadata',
    ],
    [
      'a function that is down',
      'POST https://api.test/functions/v1/reservation-ownership',
      () => new Response('boom', { status: 500 }),
      'reservation-ownership',
    ],
  ])('fails on %s', async (_name, route, response, expectedCheck) => {
    const results = await runChecks(config, healthy({ [route]: response }))
    const failed = results.filter((r) => !r.ok)
    expect(failed.length).toBe(1)
    expect(failed[0]!.name).toContain(expectedCheck)
    expect(summarize(results).failed).toBe(1)
  })

  it('reports network failures instead of crashing', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof fetch
    const results = await runChecks(config, down)
    expect(results.every((r) => !r.ok && r.detail.includes('request failed'))).toBe(true)
  })
})
