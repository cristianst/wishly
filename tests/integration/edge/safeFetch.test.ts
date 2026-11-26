import { safeFetchHtml, type SafeFetchDeps } from '../../../supabase/functions/_shared/safeFetch'

const PUBLIC = ['93.184.216.34']
const html = (body: string, init: ResponseInit = {}) =>
  new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    ...init,
  })

interface Recorded {
  url: string
  init: RequestInit
}

function setup(
  routes: Record<string, () => Response | Promise<Response>>,
  dns: Record<string, string[]> = {},
) {
  const requests: Recorded[] = []
  const lookups: string[] = []
  const deps: SafeFetchDeps = {
    async resolve(host) {
      lookups.push(host)
      const answer = dns[host] ?? PUBLIC
      if (answer.length === 0) throw new Error('NXDOMAIN')
      return answer
    },
    async fetch(url, init) {
      requests.push({ url, init })
      const route = routes[url]
      if (!route) throw new Error(`unexpected request to ${url}`)
      return route()
    },
  }
  return { deps, requests, lookups }
}

const redirect =
  (location: string, status = 302) =>
  () =>
    new Response(null, { status, headers: { location } })

describe('safeFetchHtml: happy path', () => {
  it('returns the page and the final URL', async () => {
    const { deps } = setup({
      'https://shop.example.com/p?id=1': () => html('<title>Shirt</title>'),
    })
    const result = await safeFetchHtml('https://shop.example.com/p?id=1#frag', deps)
    expect(result).toEqual({
      ok: true,
      html: '<title>Shirt</title>',
      finalUrl: 'https://shop.example.com/p?id=1',
    })
  })

  it('never sends credentials, cookies, auth or a referrer, and does not follow redirects itself', async () => {
    const { deps, requests } = setup({ 'https://shop.example.com/p': () => html('x') })
    await safeFetchHtml('https://shop.example.com/p', deps)
    const { init } = requests[0]!
    expect(init.method).toBe('GET')
    expect(init.redirect).toBe('manual')
    expect(init.credentials).toBe('omit')
    expect(init.referrerPolicy).toBe('no-referrer')
    const headers = Object.fromEntries(
      Object.entries(init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    )
    expect(Object.keys(headers).sort()).toEqual(['accept', 'accept-language', 'user-agent'])
    expect(headers['user-agent']).toContain('WishlyBot') // honest about being a bot; never impersonates a browser
  })

  it('decodes the declared charset', async () => {
    const latin1 = new Uint8Array([
      0x3c, 0x74, 0x69, 0x74, 0x6c, 0x65, 0x3e, 0x42, 0xfc, 0x63, 0x68, 0x65, 0x72, 0x3c, 0x2f,
      0x74, 0x69, 0x74, 0x6c, 0x65, 0x3e,
    ]) // "<title>Bücher</title>"
    const { deps } = setup({
      'https://shop.example.com/': () =>
        new Response(latin1, { headers: { 'content-type': 'text/html; charset=iso-8859-1' } }),
    })
    const result = await safeFetchHtml('https://shop.example.com/', deps)
    expect(result).toMatchObject({ ok: true, html: '<title>Bücher</title>' })
  })
})

describe('safeFetchHtml: SSRF protection', () => {
  it.each([
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://2130706433/',
    'http://localhost/',
    'https://shop.example.com:8443/',
    'ftp://shop.example.com/',
    'https://u:p@shop.example.com/',
  ])('refuses %s without any network access', async (url) => {
    const { deps, requests, lookups } = setup({})
    expect(await safeFetchHtml(url, deps)).toEqual({ ok: false, reason: 'URL_NOT_ALLOWED' })
    expect(requests).toHaveLength(0)
    expect(lookups).toHaveLength(0)
  })

  it('refuses a hostname that resolves to a private address', async () => {
    const { deps, requests } = setup({}, { 'evil.example.com': ['10.0.0.8'] })
    expect(await safeFetchHtml('https://evil.example.com/', deps)).toEqual({
      ok: false,
      reason: 'URL_NOT_ALLOWED',
    })
    expect(requests).toHaveLength(0)
  })

  it('refuses when ANY resolved address is private (mixed DNS answers)', async () => {
    const { deps, requests } = setup({}, { 'mixed.example.com': ['93.184.216.34', '127.0.0.1'] })
    expect((await safeFetchHtml('https://mixed.example.com/', deps)).ok).toBe(false)
    expect(requests).toHaveLength(0)
  })

  it('refuses the cloud metadata address even via a DNS name', async () => {
    const { deps } = setup({}, { 'meta.example.com': ['169.254.169.254'] })
    expect(await safeFetchHtml('https://meta.example.com/', deps)).toEqual({
      ok: false,
      reason: 'URL_NOT_ALLOWED',
    })
  })

  it('treats a failing DNS lookup as unreachable', async () => {
    const { deps } = setup({}, { 'gone.example.com': [] })
    expect(await safeFetchHtml('https://gone.example.com/', deps)).toEqual({
      ok: false,
      reason: 'UNREACHABLE',
    })
  })
})

describe('safeFetchHtml: redirects', () => {
  it('follows redirects, resolving relative locations', async () => {
    const { deps, requests } = setup({
      'https://shop.example.com/a': redirect('/b?x=1'),
      'https://shop.example.com/b?x=1': redirect('https://cdn.example.com/c', 301),
      'https://cdn.example.com/c': () => html('done'),
    })
    expect(await safeFetchHtml('https://shop.example.com/a', deps)).toMatchObject({
      ok: true,
      html: 'done',
      finalUrl: 'https://cdn.example.com/c',
    })
    expect(requests.map((r) => r.url)).toEqual([
      'https://shop.example.com/a',
      'https://shop.example.com/b?x=1',
      'https://cdn.example.com/c',
    ])
  })

  it.each([
    'http://127.0.0.1/admin',
    'http://169.254.169.254/latest/meta-data/',
    'http://localhost:8080/',
    'file:///etc/passwd',
    'ftp://shop.example.com/',
    'http://internal.local/',
    'gopher://x/',
    'javascript:alert(1)',
  ])('does not follow a redirect to %s', async (target) => {
    const { deps, requests } = setup({ 'https://shop.example.com/a': redirect(target) })
    expect(await safeFetchHtml('https://shop.example.com/a', deps)).toEqual({
      ok: false,
      reason: 'URL_NOT_ALLOWED',
    })
    expect(requests).toHaveLength(1)
  })

  it('re-resolves DNS on every hop and blocks a redirect to a name that resolves privately', async () => {
    const { deps, requests, lookups } = setup(
      { 'https://shop.example.com/a': redirect('https://sneaky.example.com/x') },
      { 'sneaky.example.com': ['192.168.1.10'] },
    )
    expect(await safeFetchHtml('https://shop.example.com/a', deps)).toEqual({
      ok: false,
      reason: 'URL_NOT_ALLOWED',
    })
    expect(lookups).toEqual(['shop.example.com', 'sneaky.example.com'])
    expect(requests).toHaveLength(1)
  })

  it('gives up after too many redirects and on redirect loops', async () => {
    const { deps, requests } = setup({
      'https://shop.example.com/loop': redirect('https://shop.example.com/loop'),
    })
    expect(await safeFetchHtml('https://shop.example.com/loop', deps)).toEqual({
      ok: false,
      reason: 'UNREACHABLE',
    })
    expect(requests).toHaveLength(5) // initial request + 4 redirects
  })

  it('rejects a redirect without a location', async () => {
    const { deps } = setup({
      'https://shop.example.com/a': () => new Response(null, { status: 302 }),
    })
    expect(await safeFetchHtml('https://shop.example.com/a', deps)).toEqual({
      ok: false,
      reason: 'UNREACHABLE',
    })
  })
})

describe('safeFetchHtml: responses', () => {
  it.each([
    [403, 'BLOCKED'],
    [429, 'BLOCKED'],
    [400, 'BLOCKED'],
    [503, 'BLOCKED'],
    [404, 'UNREACHABLE'],
    [410, 'UNREACHABLE'],
    [500, 'UNREACHABLE'],
    [502, 'UNREACHABLE'],
  ] as const)('maps HTTP %i to %s', async (status, reason) => {
    const { deps } = setup({ 'https://shop.example.com/': () => new Response('no', { status }) })
    expect(await safeFetchHtml('https://shop.example.com/', deps)).toEqual({ ok: false, reason })
  })

  it.each([
    'application/json',
    'application/pdf',
    'image/png',
    'text/plain',
    'application/octet-stream',
  ])('rejects %s', async (type) => {
    const { deps } = setup({
      'https://shop.example.com/': () => new Response('x', { headers: { 'content-type': type } }),
    })
    expect(await safeFetchHtml('https://shop.example.com/', deps)).toEqual({
      ok: false,
      reason: 'NOT_HTML',
    })
  })

  it('rejects a response with no content type', async () => {
    const { deps } = setup({
      'https://shop.example.com/': () => new Response('x', { headers: {} }),
    })
    // Response() defaults a string body to text/plain
    expect((await safeFetchHtml('https://shop.example.com/', deps)).ok).toBe(false)
  })

  it('accepts XHTML', async () => {
    const { deps } = setup({
      'https://shop.example.com/': () =>
        new Response('<html/>', { headers: { 'content-type': 'application/xhtml+xml' } }),
    })
    expect((await safeFetchHtml('https://shop.example.com/', deps)).ok).toBe(true)
  })

  it('caps the number of bytes read and cancels the rest of the stream', async () => {
    let cancelled = false
    let produced = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        produced += 1000
        controller.enqueue(new Uint8Array(1000).fill(65))
      },
      cancel() {
        cancelled = true
      },
    })
    const { deps } = setup({
      'https://shop.example.com/': () =>
        new Response(stream, { headers: { 'content-type': 'text/html' } }),
    })
    const result = await safeFetchHtml('https://shop.example.com/', deps, {
      maxRedirects: 4,
      timeoutMs: 2000,
      maxBytes: 2500,
    })
    expect(result.ok && result.html.length).toBe(2500)
    expect(cancelled).toBe(true)
    expect(produced).toBeLessThan(10_000)
  })

  it('aborts on the overall deadline, even mid-body', async () => {
    const { deps } = setup({
      'https://shop.example.com/': () => new Promise<Response>(() => undefined), // never answers
    })
    const stalled: SafeFetchDeps = {
      ...deps,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
    }
    const started = Date.now()
    expect(
      await safeFetchHtml('https://shop.example.com/', stalled, {
        maxRedirects: 4,
        timeoutMs: 60,
        maxBytes: 1000,
      }),
    ).toEqual({
      ok: false,
      reason: 'UNREACHABLE',
    })
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it('reports network errors as unreachable without leaking details', async () => {
    const { deps } = setup({
      'https://shop.example.com/': () => {
        throw new TypeError('connect ECONNREFUSED 10.1.2.3:443')
      },
    })
    expect(await safeFetchHtml('https://shop.example.com/', deps)).toEqual({
      ok: false,
      reason: 'UNREACHABLE',
    })
  })
})
