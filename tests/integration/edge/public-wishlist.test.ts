import {
  RATE_LIMIT,
  handlePublicWishlist,
  type PublicWishlistDeps,
} from '../../../supabase/functions/public-wishlist/handler'

const TOKEN = 'a'.repeat(64)
const WISHLIST = {
  title: 'Birthday',
  description: null,
  items: [{ id: '1', title: 'Lamp', reserved: false }],
}

function deps(overrides: Partial<PublicWishlistDeps> = {}): PublicWishlistDeps {
  return {
    getWishlist: vi.fn(async (token: string) => (token === TOKEN ? WISHLIST : null)),
    checkRateLimit: vi.fn(async () => true),
    ...overrides,
  }
}

const post = (body: unknown, init: RequestInit = {}) =>
  new Request('https://edge.test/public-wishlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  })

describe('public-wishlist handler', () => {
  it('returns the sanitized wishlist for a valid token', async () => {
    const response = await handlePublicWishlist(post({ token: TOKEN }), deps())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ wishlist: WISHLIST })
  })

  it('marks every response as private, uncacheable and non-indexable', async () => {
    for (const response of [
      await handlePublicWishlist(post({ token: TOKEN }), deps()),
      await handlePublicWishlist(post({ token: 'b'.repeat(64) }), deps()),
    ]) {
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
      expect(response.headers.get('x-robots-tag')).toContain('noindex')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    }
  })

  it('gives unknown, rotated and malformed tokens the same 404', async () => {
    const bodies = await Promise.all(
      [
        { token: 'b'.repeat(64) },
        { token: 'short' },
        { token: 42 },
        { token: '../etc/passwd' },
        {},
      ].map(async (payload) => {
        const response = await handlePublicWishlist(post(payload), deps())
        expect(response.status).toBe(404)
        return response.json()
      }),
    )
    expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(1)
    expect(bodies[0]).toEqual({ error: { code: 'NOT_FOUND' } })
  })

  it('does not query the database for malformed tokens', async () => {
    const d = deps()
    await handlePublicWishlist(post({ token: "' OR 1=1 --" }), d)
    expect(d.getWishlist).not.toHaveBeenCalled()
  })

  it('rejects other methods, bad JSON and oversized bodies', async () => {
    expect(
      (await handlePublicWishlist(new Request('https://edge.test/', { method: 'GET' }), deps()))
        .status,
    ).toBe(405)
    expect((await handlePublicWishlist(post('not json'), deps())).status).toBe(400)
    expect((await handlePublicWishlist(post('[]'), deps())).status).toBe(400)
    expect(
      (await handlePublicWishlist(post({ token: TOKEN, pad: 'x'.repeat(5000) }), deps())).status,
    ).toBe(400)
  })

  it('answers CORS preflight without touching the database', async () => {
    const d = deps()
    const response = await handlePublicWishlist(
      new Request('https://edge.test/', { method: 'OPTIONS' }),
      d,
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-methods')).toContain('POST')
    expect(d.checkRateLimit).not.toHaveBeenCalled()
  })

  it('returns 429 when rate limited, before reading anything', async () => {
    const d = deps({ checkRateLimit: vi.fn(async () => false) })
    const response = await handlePublicWishlist(post({ token: TOKEN }), d)
    expect(response.status).toBe(429)
    expect(await response.json()).toEqual({ error: { code: 'RATE_LIMITED' } })
    expect(d.getWishlist).not.toHaveBeenCalled()
  })

  it('rate-limits by a hashed client key, never the raw IP', async () => {
    const d = deps()
    await handlePublicWishlist(
      post(
        { token: TOKEN },
        {
          headers: {
            'x-forwarded-for': '203.0.113.7, 10.0.0.1',
            'content-type': 'application/json',
          },
        },
      ),
      d,
    )
    const [key, limit, windowSeconds] = vi.mocked(d.checkRateLimit).mock.calls[0]!
    expect(key).toMatch(/^public-wishlist:[0-9a-f]{32}$/)
    expect(key).not.toContain('203.0.113.7')
    expect([limit, windowSeconds]).toEqual([RATE_LIMIT.limit, RATE_LIMIT.windowSeconds])
  })

  it('hides internal failures and never logs the token', async () => {
    const log = vi.fn()
    const d = deps({
      getWishlist: vi.fn(async () => {
        throw new Error(`db exploded for ${TOKEN}`)
      }),
      log,
    })
    const response = await handlePublicWishlist(post({ token: TOKEN }), d)
    expect(response.status).toBe(500)
    expect(await response.text()).not.toContain(TOKEN)
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN)
  })
})
