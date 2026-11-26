import { areAllAddressesPublic, isBlockedIp, parseProductUrl } from './ssrf.ts'

export interface SafeFetchDeps {
  /** Resolves a hostname to every A and AAAA address. Injected so tests need no network. */
  resolve(hostname: string): Promise<string[]>
  fetch(input: string, init: RequestInit): Promise<Response>
}

export interface SafeFetchLimits {
  maxRedirects: number
  /** One deadline for the whole operation: every hop plus reading the body. */
  timeoutMs: number
  maxBytes: number
}

export const DEFAULT_LIMITS: SafeFetchLimits = {
  maxRedirects: 4,
  timeoutMs: 8_000,
  maxBytes: 1_500_000,
}

export type FetchFailure =
  | 'URL_NOT_ALLOWED' // the URL, a redirect target or a resolved address is not a public http(s) host
  | 'BLOCKED' // the shop refused an automated request
  | 'NOT_HTML'
  | 'UNREACHABLE' // DNS failure, timeout, network error, 404, 5xx, too many redirects…

export type SafeFetchResult =
  { ok: true; html: string; finalUrl: string } | { ok: false; reason: FetchFailure }

const BOT_USER_AGENT = 'Mozilla/5.0 (compatible; WishlyBot/1.0; product-preview)'
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
/** Statuses that typically mean "we don't serve automated clients", so the UI can say so. */
const BLOCKED_STATUSES = new Set([400, 401, 403, 406, 429, 451, 503])

/** Resolves and vets the host of `url`. Returns false when it must not be contacted. */
async function hostIsPublic(url: URL, deps: SafeFetchDeps): Promise<boolean> {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const isLiteral = /^[\d.]+$/.test(host) || host.includes(':')
  if (isLiteral) return !isBlockedIp(host)
  const addresses = await deps.resolve(host)
  return areAllAddressesPublic(addresses)
}

function charsetFrom(contentType: string | null, sniffed: string): string {
  const header = /charset\s*=\s*["']?([\w:.-]+)/i.exec(contentType ?? '')?.[1]
  if (header) return header
  return /<meta[^>]+charset\s*=\s*["']?([\w:.-]+)/i.exec(sniffed)?.[1] ?? 'utf-8'
}

function decode(bytes: Uint8Array, contentType: string | null): string {
  const sniffed = new TextDecoder('latin1').decode(bytes.subarray(0, 2048))
  const label = charsetFrom(contentType, sniffed)
  try {
    return new TextDecoder(label).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

/** Reads at most `maxBytes`. Metadata lives near the top, so a truncated page is still useful. */
async function readCapped(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (total < maxBytes) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    total += value.byteLength
  }
  await reader.cancel().catch(() => undefined)

  const merged = new Uint8Array(Math.min(total, maxBytes))
  let offset = 0
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, merged.length - offset)
    merged.set(slice, offset)
    offset += slice.length
    if (offset >= merged.length) break
  }
  return merged
}

/**
 * Fetches a product page without becoming a proxy into private networks.
 *  - http(s) on default ports only, no credentials, public addresses only
 *  - DNS is resolved and vetted for the first URL AND for every redirect hop (redirects are manual)
 *  - one overall deadline, a hard byte cap, HTML content types only
 *  - no cookies, no user tokens, no referrer are ever sent
 * Residual risk: the HTTP client resolves the name again when connecting, so a hostile DNS server
 * could in theory answer differently the second time (DNS rebinding). Edge Functions run in an
 * isolated runtime, which limits what such an answer could reach.
 */
export async function safeFetchHtml(
  input: string,
  deps: SafeFetchDeps,
  limits: SafeFetchLimits = DEFAULT_LIMITS,
): Promise<SafeFetchResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs)

  try {
    let parsed = parseProductUrl(input)
    for (let hop = 0; hop <= limits.maxRedirects; hop += 1) {
      if (!parsed.ok) return { ok: false, reason: 'URL_NOT_ALLOWED' }
      const url = parsed.url

      if (!(await hostIsPublic(url, deps))) return { ok: false, reason: 'URL_NOT_ALLOWED' }

      const response = await deps.fetch(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
        headers: {
          'User-Agent': BOT_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          'Accept-Language': 'en;q=0.8,de;q=0.7,es;q=0.6',
        },
      })

      if (REDIRECT_STATUSES.has(response.status)) {
        await response.body?.cancel().catch(() => undefined)
        const location = response.headers.get('location')
        if (!location) return { ok: false, reason: 'UNREACHABLE' }
        let next: URL
        try {
          next = new URL(location, url)
        } catch {
          return { ok: false, reason: 'UNREACHABLE' }
        }
        parsed = parseProductUrl(next.toString())
        continue
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        return {
          ok: false,
          reason: BLOCKED_STATUSES.has(response.status) ? 'BLOCKED' : 'UNREACHABLE',
        }
      }

      const contentType = response.headers.get('content-type')
      if (!/\b(text\/html|application\/xhtml\+xml)\b/i.test(contentType ?? '')) {
        await response.body?.cancel().catch(() => undefined)
        return { ok: false, reason: 'NOT_HTML' }
      }

      const bytes = await readCapped(response, limits.maxBytes)
      return { ok: true, html: decode(bytes, contentType), finalUrl: url.toString() }
    }
    return { ok: false, reason: 'UNREACHABLE' } // too many redirects
  } catch {
    return { ok: false, reason: 'UNREACHABLE' } // DNS failure, timeout/abort, network error
  } finally {
    clearTimeout(timer)
  }
}
