import {
  extractProductMetadata,
  type ExtractionStatus,
  type ProductMetadata,
} from '../_shared/metadata.ts'
import { errorResponse, json, preflight, readJsonObject } from '../_shared/http.ts'
import type { SafeFetchResult } from '../_shared/safeFetch.ts'
import { parseProductUrl } from '../_shared/ssrf.ts'

export const RATE_LIMIT = { limit: 20, windowSeconds: 60 }

export type FailureReason = 'BLOCKED' | 'NOT_HTML' | 'UNREACHABLE' | 'NO_DATA'

export interface ProductMetadataResponse extends ProductMetadata {
  sourceUrl: string
  extractionStatus: ExtractionStatus
  failureReason?: FailureReason
}

export interface ProductMetadataDeps {
  /** Verifies the caller's session with the auth server. Null for missing, invalid or anonymous users. */
  authenticate(request: Request): Promise<{ userId: string } | null>
  checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean>
  /** The SSRF-safe page fetcher. */
  fetchPage(url: string): Promise<SafeFetchResult>
  log?(message: string): void
}

async function userKey(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId))
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * POST { url } -> 200 { sourceUrl, extractionStatus, title?, description?, imageUrl?, price?, currency?, failureReason? }
 *  - 401 UNAUTHORIZED: not a signed-in (non-anonymous) creator
 *  - 400 INVALID_URL: malformed, non-http(s), credentials, odd port, or an internal/private destination
 *  - 429 RATE_LIMITED
 * A page that cannot be read (blocked, not HTML, unreachable, nothing found) is NOT an error: it is a
 * 200 with extractionStatus "failed", so the form simply continues in manual mode.
 */
export async function handleProductMetadata(
  request: Request,
  deps: ProductMetadataDeps,
): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight()
  if (request.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 405)

  try {
    const user = await deps.authenticate(request)
    if (!user) return errorResponse('UNAUTHORIZED', 401)

    const key = `product-metadata:${await userKey(user.userId)}`
    if (!(await deps.checkRateLimit(key, RATE_LIMIT.limit, RATE_LIMIT.windowSeconds))) {
      return errorResponse('RATE_LIMITED', 429)
    }

    const body = await readJsonObject(request)
    if (!body || typeof body.url !== 'string') return errorResponse('INVALID_URL', 400)

    const parsed = parseProductUrl(body.url)
    if (!parsed.ok) return errorResponse('INVALID_URL', 400)
    const sourceUrl = parsed.url.toString() // original link, fragment dropped, every query parameter kept

    const page = await deps.fetchPage(sourceUrl)
    if (!page.ok) {
      if (page.reason === 'URL_NOT_ALLOWED') return errorResponse('INVALID_URL', 400)
      deps.log?.(`product-metadata: fetch failed (${page.reason})`)
      const failed: ProductMetadataResponse = {
        sourceUrl,
        extractionStatus: 'failed',
        failureReason: page.reason,
      }
      return json(failed)
    }

    const { extractionStatus, looksBlocked, ...found } = extractProductMetadata(
      page.html,
      page.finalUrl,
    )
    const response: ProductMetadataResponse = {
      ...found,
      sourceUrl,
      extractionStatus,
      // A bot wall or generic site card counts as "blocked" so the user sees the right message.
      ...(extractionStatus === 'failed'
        ? { failureReason: looksBlocked ? ('BLOCKED' as const) : ('NO_DATA' as const) }
        : {}),
    }
    return json(response)
  } catch {
    // Never echo internals; never log the URL (it can carry personal tokens).
    deps.log?.('product-metadata: unexpected failure')
    return errorResponse('INTERNAL', 500)
  }
}
