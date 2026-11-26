import { clientKey, errorResponse, json, preflight, readJsonObject } from '../_shared/http.ts'
import {
  RESERVATION_SECRET_PATTERN,
  SHARE_TOKEN_PATTERN,
  UUID_PATTERN,
  sha256Hex,
} from '../_shared/reservation.ts'

export const RATE_LIMIT = { limit: 30, windowSeconds: 60 }

export type ReserveOutcome = 'created' | 'already_yours' | 'conflict' | 'not_found'
export type CancelOutcome = 'cancelled' | 'none' | 'not_yours' | 'not_found'

export interface ReservationDeps {
  reserve(shareToken: string, itemId: string, claimHash: string): Promise<ReserveOutcome>
  cancel(shareToken: string, itemId: string, claimHash: string): Promise<CancelOutcome>
  checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean>
  log?(message: string): void
}

/**
 * POST   { shareToken, itemId, reservationSecret } -> 201 | 200 (same guest retry) | 409 | 404
 * DELETE { shareToken, itemId, reservationSecret } -> 200 | 403 (not the holder) | 404
 * The raw secret is hashed here; only the digest reaches the database. Nothing sensitive is logged.
 */
export async function handleReservations(
  request: Request,
  deps: ReservationDeps,
): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight()
  if (request.method !== 'POST' && request.method !== 'DELETE')
    return errorResponse('METHOD_NOT_ALLOWED', 405)

  try {
    const key = `reservations:${await clientKey(request)}`
    if (!(await deps.checkRateLimit(key, RATE_LIMIT.limit, RATE_LIMIT.windowSeconds))) {
      return errorResponse('RATE_LIMITED', 429)
    }

    const body = await readJsonObject(request)
    if (!body) return errorResponse('INVALID_REQUEST', 400)

    const { shareToken, itemId, reservationSecret } = body
    if (typeof shareToken !== 'string' || !SHARE_TOKEN_PATTERN.test(shareToken)) {
      return errorResponse('NOT_FOUND', 404)
    }
    if (
      typeof itemId !== 'string' ||
      !UUID_PATTERN.test(itemId) ||
      typeof reservationSecret !== 'string' ||
      !RESERVATION_SECRET_PATTERN.test(reservationSecret)
    ) {
      return errorResponse('INVALID_REQUEST', 400)
    }

    const claimHash = await sha256Hex(reservationSecret)

    if (request.method === 'POST') {
      switch (await deps.reserve(shareToken, itemId, claimHash)) {
        case 'created':
          return json({ status: 'reserved' }, 201)
        case 'already_yours':
          return json({ status: 'reserved' }, 200)
        case 'conflict':
          return errorResponse('RESERVATION_CONFLICT', 409)
        case 'not_found':
          return errorResponse('NOT_FOUND', 404)
      }
    } else {
      switch (await deps.cancel(shareToken, itemId, claimHash)) {
        case 'cancelled':
        case 'none':
          return json({ status: 'cancelled' }, 200)
        case 'not_yours':
          return errorResponse('NOT_RESERVATION_OWNER', 403)
        case 'not_found':
          return errorResponse('NOT_FOUND', 404)
      }
    }
    return errorResponse('INTERNAL', 500)
  } catch {
    deps.log?.('reservations: unexpected failure')
    return errorResponse('INTERNAL', 500)
  }
}
