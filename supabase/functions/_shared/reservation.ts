// Validation and hashing shared by the reservation Edge Functions.

export const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** 256-bit secrets encode to 43 base64url characters; allow headroom, but bound it. */
export const RESERVATION_SECRET_PATTERN = /^[A-Za-z0-9_-]{43,128}$/
export const MAX_PROOFS = 50

/** The database only ever sees this digest, never the guest's secret. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
