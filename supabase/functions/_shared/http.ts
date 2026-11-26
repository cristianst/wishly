// Helpers shared by Edge Functions. Plain Web APIs only, so they also run under Node for tests.

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

/** Headers for responses that contain share-link or reservation-sensitive data. */
const PRIVATE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      ...PRIVATE_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
    },
  })
}

/** Stable error codes the frontend maps to localized messages. */
export function errorResponse(code: string, status: number): Response {
  return json({ error: { code } }, status)
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

/**
 * Reads a small JSON body. Returns null for oversized, non-JSON or non-object payloads.
 * The size limit applies to the actual bytes, not to a client-declared Content-Length.
 */
export async function readJsonObject(
  request: Request,
  maxBytes = 4096,
): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  if (declared > maxBytes) return null
  const text = await request.text()
  if (new TextEncoder().encode(text).length > maxBytes) return null
  try {
    const parsed: unknown = JSON.parse(text)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** A stable, non-reversible identifier for rate limiting; raw IP addresses are never stored. */
export async function clientKey(request: Request): Promise<string> {
  const forwarded =
    request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for') ?? ''
  const ip = forwarded.split(',')[0]?.trim() || 'unknown'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip))
  return Array.from(new Uint8Array(digest))
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
