import { clientKey, errorResponse, json, preflight, readJsonObject } from '../_shared/http.ts'
import {
  MAX_PROOFS,
  RESERVATION_SECRET_PATTERN,
  SHARE_TOKEN_PATTERN,
  UUID_PATTERN,
  sha256Hex,
} from '../_shared/reservation.ts'

export const RATE_LIMIT = { limit: 60, windowSeconds: 60 }

export interface OwnershipProof {
  itemId: string
  claimHash: string
}

export interface OwnershipDeps {
  /** Returns the subset of item ids whose reservation matches the supplied digest. */
  getOwnedItemIds(shareToken: string, proofs: OwnershipProof[]): Promise<string[]>
  checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean>
  log?(message: string): void
}

/**
 * POST { shareToken, proofs: [{ itemId, reservationSecret }] (<= 50) } -> 200 { ownedItemIds }
 * Tells a browser which of its locally remembered secrets still hold a reservation, so
 * "Reserved by you" is verified by the server and never inferred from localStorage alone.
 */
export async function handleReservationOwnership(
  request: Request,
  deps: OwnershipDeps,
): Promise<Response> {
  if (request.method === 'OPTIONS') return preflight()
  if (request.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 405)

  try {
    const key = `reservation-ownership:${await clientKey(request)}`
    if (!(await deps.checkRateLimit(key, RATE_LIMIT.limit, RATE_LIMIT.windowSeconds))) {
      return errorResponse('RATE_LIMITED', 429)
    }

    const body = await readJsonObject(request, 16_384)
    if (!body) return errorResponse('INVALID_REQUEST', 400)

    const { shareToken, proofs } = body
    if (typeof shareToken !== 'string' || !SHARE_TOKEN_PATTERN.test(shareToken)) {
      return errorResponse('NOT_FOUND', 404)
    }
    if (!Array.isArray(proofs) || proofs.length > MAX_PROOFS)
      return errorResponse('INVALID_REQUEST', 400)
    if (proofs.length === 0) return json({ ownedItemIds: [] })

    const hashed: OwnershipProof[] = []
    for (const proof of proofs) {
      const candidate = (proof ?? {}) as { itemId?: unknown; reservationSecret?: unknown }
      if (
        typeof candidate.itemId !== 'string' ||
        !UUID_PATTERN.test(candidate.itemId) ||
        typeof candidate.reservationSecret !== 'string' ||
        !RESERVATION_SECRET_PATTERN.test(candidate.reservationSecret)
      ) {
        return errorResponse('INVALID_REQUEST', 400)
      }
      hashed.push({
        itemId: candidate.itemId,
        claimHash: await sha256Hex(candidate.reservationSecret),
      })
    }

    const owned = await deps.getOwnedItemIds(shareToken, hashed)
    return json({ ownedItemIds: owned })
  } catch {
    deps.log?.('reservation-ownership: unexpected failure')
    return errorResponse('INTERNAL', 500)
  }
}
