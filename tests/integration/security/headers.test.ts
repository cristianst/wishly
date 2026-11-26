import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../../..')
const headersFile = readFileSync(resolve(root, 'public/_headers'), 'utf8')

/** Parses Cloudflare's `_headers` format into path -> header name -> value. */
function parseHeaders(text: string): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {}
  let current: Record<string, string> | null = null
  for (const line of text.split('\n')) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    if (!line.startsWith(' ')) {
      current = rules[line.trim()] = {}
    } else if (current) {
      const colon = line.indexOf(':')
      current[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
    }
  }
  return rules
}

const rules = parseHeaders(headersFile)
const csp = Object.fromEntries(
  (rules['/*']?.['Content-Security-Policy'] ?? '')
    .split(';')
    .map((part) => part.trim().split(/\s+/))
    .filter((parts) => parts[0])
    .map(([name, ...values]) => [name, values]),
)

describe('security headers (public/_headers)', () => {
  it('ships a Content-Security-Policy with no script escape hatches', () => {
    expect(csp['script-src']).toEqual(["'self'"])
    expect(csp['default-src']).toEqual(["'self'"])
    expect(csp['script-src']?.join(' ')).not.toMatch(/unsafe-inline|unsafe-eval|\*|https?:/)
  })

  it('forbids plugins, framing and base-tag/form hijacking', () => {
    expect(csp['object-src']).toEqual(["'none'"])
    expect(csp['frame-ancestors']).toEqual(["'none'"])
    expect(csp['base-uri']).toEqual(["'self'"])
    expect(csp['form-action']).toEqual(["'self'"])
    expect(csp).toHaveProperty('upgrade-insecure-requests')
  })

  it('limits network access to this site and Supabase', () => {
    expect(csp['connect-src']).toEqual(["'self'", 'https://*.supabase.co'])
  })

  it('still lets merchant images load, over https only', () => {
    expect(csp['img-src']).toEqual(["'self'", 'data:', 'https:'])
    expect(csp['img-src']).not.toContain('http:')
  })

  it('sets baseline hardening headers once', () => {
    expect(rules['/*']).toMatchObject({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    })
    expect(rules['/*']?.['Permissions-Policy']).toContain('camera=()')
  })

  it('keeps shared links private: no referrer, no indexing, no caching', () => {
    expect(rules['/l/*']).toEqual({
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
      'Cache-Control': 'no-store',
    })
  })

  it('does not set the same header in two matching rules (values would be merged)', () => {
    const globalNames = Object.keys(rules['/*'] ?? {})
    for (const [path, headers] of Object.entries(rules)) {
      if (path === '/*') continue
      for (const name of Object.keys(headers))
        expect(globalNames, `${name} on ${path}`).not.toContain(name)
    }
    expect(Object.keys(rules['/assets/*'] ?? {})).toEqual(['Cache-Control'])
    // /assets/* and /l/* never overlap, so Cache-Control is not duplicated.
  })

  it('is compatible with the policy: index.html has no inline scripts', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8')
    const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map((match) => match[1] ?? '')
    expect(scripts.length).toBeGreaterThan(0)
    for (const attributes of scripts) expect(attributes).toMatch(/\bsrc=/)
    expect(html).not.toMatch(/\son[a-z]+=/i) // no inline event handlers
  })
})
