import { clientKey, errorResponse, json, preflight, readJsonObject } from '../_shared/http.ts'

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/
export const RATE_LIMIT = { limit: 60, windowSeconds: 60 }

export interface PublicWishlistDeps {
  /** Calls the locked-down database function; returns null for unknown/rotated tokens. */
  getWishlist(token: string): Promise<unknown | null>
  /** Returns false once the caller is over the limit. */
  checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean>
  log?(message: string): void
}

/**
 * POST { token } -> 200 { wishlist } | 404 NOT_FOUND | 429 RATE_LIMITED.
 * The token travels in the body (not the URL) so it stays out of gateway access logs.
 * Unknown, rotated and malformed tokens are indistinguishable.
 */
export async function handlePublicWishlist(
  request: Request,
  deps: PublicWishlistDeps,
): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight()
  if (request.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 405)

  try {
    const key = `public-wishlist:${await clientKey(request)}`
    if (!(await deps.checkRateLimit(key, RATE_LIMIT.limit, RATE_LIMIT.windowSeconds))) {
      return errorResponse('RATE_LIMITED', 429)
    }

    const body = await readJsonObject(request)
    if (!body) return errorResponse('INVALID_REQUEST', 400)

    const token = body.token
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token))
      return errorResponse('NOT_FOUND', 404)

    const wishlist = await deps.getWishlist(token)
    if (wishlist === null || wishlist === undefined) return errorResponse('NOT_FOUND', 404)
    return json({ wishlist })
  } catch {
    // Never echo internals, and never log the token or the request body.
    deps.log?.('public-wishlist: unexpected failure')
    return errorResponse('INTERNAL', 500)
  }
}
