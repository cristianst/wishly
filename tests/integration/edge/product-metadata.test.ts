import {
  RATE_LIMIT,
  handleProductMetadata,
  type ProductMetadataDeps,
} from '../../../supabase/functions/product-metadata/handler'
import type { SafeFetchResult } from '../../../supabase/functions/_shared/safeFetch'

const PAGE = `<html><head>
  <meta property="og:title" content="Real Madrid Trikot">
  <meta property="og:image" content="https://img.example.com/trikot.jpg">
  <meta property="product:price:amount" content="89,95"><meta property="product:price:currency" content="EUR">
</head></html>`

function deps(overrides: Partial<ProductMetadataDeps> = {}): ProductMetadataDeps {
  return {
    authenticate: vi.fn(async () => ({ userId: 'user-1' })),
    checkRateLimit: vi.fn(async () => true),
    fetchPage: vi.fn(async (url: string): Promise<SafeFetchResult> => ({
      ok: true,
      html: PAGE,
      finalUrl: url,
    })),
    ...overrides,
  }
}

const call = (body: unknown, init: RequestInit = {}) =>
  new Request('https://edge.test/product-metadata', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer user-jwt' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  })

const OTTO = 'https://www.otto.de/p/adidas-trikot-C2035964495/?variationId=2035964499#ech=29928335'

describe('POST /product-metadata', () => {
  it('returns normalized metadata for a signed-in creator', async () => {
    const response = await handleProductMetadata(call({ url: OTTO }), deps())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      title: 'Real Madrid Trikot',
      imageUrl: 'https://img.example.com/trikot.jpg',
      price: 89.95,
      currency: 'EUR',
      sourceUrl: 'https://www.otto.de/p/adidas-trikot-C2035964495/?variationId=2035964499',
      extractionStatus: 'success',
    })
  })

  it('keeps product-variation query parameters and fetches exactly that URL (minus the fragment)', async () => {
    const d = deps()
    await handleProductMetadata(call({ url: OTTO }), d)
    expect(d.fetchPage).toHaveBeenCalledWith(
      'https://www.otto.de/p/adidas-trikot-C2035964495/?variationId=2035964499',
    )
  })

  it('is private and uncacheable', async () => {
    const response = await handleProductMetadata(call({ url: OTTO }), deps())
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})

describe('authorization', () => {
  it('rejects callers who are not signed-in creators, before doing anything else', async () => {
    const d = deps({ authenticate: vi.fn(async () => null) })
    const response = await handleProductMetadata(call({ url: OTTO }), d)
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: { code: 'UNAUTHORIZED' } })
    expect(d.checkRateLimit).not.toHaveBeenCalled()
    expect(d.fetchPage).not.toHaveBeenCalled()
  })

  it('never forwards the caller’s token or any header to the merchant fetch', async () => {
    const d = deps()
    await handleProductMetadata(
      call(
        { url: OTTO },
        {
          headers: {
            authorization: 'Bearer secret-token',
            cookie: 'sb=1',
            'content-type': 'application/json',
          },
        },
      ),
      d,
    )
    expect(JSON.stringify(vi.mocked(d.fetchPage).mock.calls)).not.toMatch(/secret-token|sb=1/)
    expect(vi.mocked(d.fetchPage).mock.calls[0]).toHaveLength(1) // URL only
  })
})

describe('input validation (SSRF)', () => {
  it.each([
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost:3000/',
    'http://[::1]/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'ftp://shop.example.com/',
    'https://user:pw@shop.example.com/',
    'https://shop.example.com:8443/',
    'not a url',
    '',
    'http://2130706433/',
    'http://intranet/',
  ])('rejects %j without fetching anything', async (url) => {
    const d = deps()
    const response = await handleProductMetadata(call({ url }), d)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: { code: 'INVALID_URL' } })
    expect(d.fetchPage).not.toHaveBeenCalled()
  })

  it.each([{}, { url: 42 }, { url: null }, [], 'nope', { url: ['https://shop.example.com'] }])(
    'rejects body %j',
    async (body) => {
      const d = deps()
      expect((await handleProductMetadata(call(body), d)).status).toBe(400)
      expect(d.fetchPage).not.toHaveBeenCalled()
    },
  )

  it('treats a redirect/DNS rejection from the fetcher as an invalid URL', async () => {
    const d = deps({
      fetchPage: vi.fn(async () => ({ ok: false, reason: 'URL_NOT_ALLOWED' }) as SafeFetchResult),
    })
    const response = await handleProductMetadata(call({ url: 'https://evil.example.com/' }), d)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: { code: 'INVALID_URL' } })
  })

  it('rejects oversized bodies', async () => {
    const d = deps()
    expect(
      (await handleProductMetadata(call({ url: OTTO, pad: 'x'.repeat(6000) }), d)).status,
    ).toBe(400)
  })
})

describe('pages that cannot be read are not errors', () => {
  it.each(['BLOCKED', 'NOT_HTML', 'UNREACHABLE'] as const)(
    'returns a 200 "failed" result for %s so the form stays usable',
    async (reason) => {
      const d = deps({ fetchPage: vi.fn(async () => ({ ok: false, reason }) as SafeFetchResult) })
      const response = await handleProductMetadata(call({ url: OTTO }), d)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        sourceUrl: 'https://www.otto.de/p/adidas-trikot-C2035964495/?variationId=2035964499',
        extractionStatus: 'failed',
        failureReason: reason,
      })
    },
  )

  it('reports NO_DATA for a JavaScript-only page, and never invents a price', async () => {
    const d = deps({
      fetchPage: vi.fn(async (url: string): Promise<SafeFetchResult> => ({
        ok: true,
        html: '<div id="app"></div>',
        finalUrl: url,
      })),
    })
    const body = await (await handleProductMetadata(call({ url: OTTO }), d)).json()
    expect(body).toMatchObject({ extractionStatus: 'failed', failureReason: 'NO_DATA' })
    expect(body).not.toHaveProperty('price')
  })

  it('reports partial results', async () => {
    const d = deps({
      fetchPage: vi.fn(async (url: string): Promise<SafeFetchResult> => ({
        ok: true,
        html: '<title>Just a title</title>',
        finalUrl: url,
      })),
    })
    const body = await (await handleProductMetadata(call({ url: OTTO }), d)).json()
    expect(body).toMatchObject({ extractionStatus: 'partial', title: 'Just a title' })
    expect(body).not.toHaveProperty('failureReason')
  })

  it('resolves relative image links against the final (post-redirect) URL', async () => {
    const d = deps({
      fetchPage: vi.fn(async (): Promise<SafeFetchResult> => ({
        ok: true,
        html: '<meta property="og:title" content="T"><meta property="og:image" content="/img/a.png">',
        finalUrl: 'https://cdn.example.com/final/page',
      })),
    })
    const body = await (await handleProductMetadata(call({ url: OTTO }), d)).json()
    expect(body.imageUrl).toBe('https://cdn.example.com/img/a.png')
  })
})

describe('abuse protection and hygiene', () => {
  it('rate limits per user with a hashed key', async () => {
    const d = deps({ checkRateLimit: vi.fn(async () => false) })
    const response = await handleProductMetadata(call({ url: OTTO }), d)
    expect(response.status).toBe(429)
    expect(d.fetchPage).not.toHaveBeenCalled()
    const [key, limit, window] = vi.mocked(d.checkRateLimit).mock.calls[0]!
    expect(key).toMatch(/^product-metadata:[0-9a-f]{32}$/)
    expect(key).not.toContain('user-1')
    expect([limit, window]).toEqual([RATE_LIMIT.limit, RATE_LIMIT.windowSeconds])
  })

  it('rejects other methods and answers preflight', async () => {
    expect(
      (await handleProductMetadata(new Request('https://edge.test/', { method: 'GET' }), deps()))
        .status,
    ).toBe(405)
    const preflight = await handleProductMetadata(
      new Request('https://edge.test/', { method: 'OPTIONS' }),
      deps(),
    )
    expect(preflight.status).toBe(204)
  })

  it('hides internal failures and never logs the URL', async () => {
    const log = vi.fn()
    const d = deps({
      fetchPage: vi.fn(async () => {
        throw new Error(`boom ${OTTO}`)
      }),
      log,
    })
    const response = await handleProductMetadata(call({ url: OTTO }), d)
    expect(response.status).toBe(500)
    expect((await response.text()) + JSON.stringify(log.mock.calls)).not.toContain('otto.de')
  })

  it('does not log the URL or host when a page cannot be fetched', async () => {
    const log = vi.fn()
    const d = deps({
      fetchPage: vi.fn(async () => ({ ok: false, reason: 'BLOCKED' }) as SafeFetchResult),
      log,
    })
    await handleProductMetadata(call({ url: OTTO }), d)
    expect(log).toHaveBeenCalledWith('product-metadata: fetch failed (BLOCKED)')
    expect(JSON.stringify(log.mock.calls)).not.toContain('otto')
  })
})

describe('generic pages are reported as blocked, not imported', () => {
  const amazonCard = `<title>Amazon.de</title><meta property="og:title" content="amazon"><meta property="og:image" content="https://m.media-amazon.com/images/G/01/share-icons/previewdoh/amazon.png">`

  it('returns a failed/BLOCKED result for the Amazon share card, with no title or image', async () => {
    const d = deps({
      fetchPage: vi.fn(async (url: string): Promise<SafeFetchResult> => ({
        ok: true,
        html: amazonCard,
        finalUrl: url,
      })),
    })
    const body = await (
      await handleProductMetadata(call({ url: 'https://www.amazon.de/dp/B0TEST' }), d)
    ).json()
    expect(body).toEqual({
      sourceUrl: 'https://www.amazon.de/dp/B0TEST',
      extractionStatus: 'failed',
      failureReason: 'BLOCKED',
    })
  })
})
