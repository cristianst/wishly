import { ApiError, type ApiErrorCode } from '@/lib/api'
import type { PublicWishlistRepository } from '@/features/public/repository'
import type { PublicWishlist } from '@/features/public/types'
import type { OwnershipProof, ReservationRepository } from '@/features/reservations/repository'

type Method = 'reserve' | 'cancel' | 'getOwnedItemIds'

export interface FakeReservationBackend {
  publicRepository: PublicWishlistRepository & { requests: string[] }
  repository: ReservationRepository
  /** item id -> secret of the current holder (the real server stores only a hash). */
  holders: Map<string, string>
  calls: { method: Method; itemId?: string; secret?: string }[]
  /** Makes the share link unknown, as after the owner rotates it. */
  revoke(): void
  /** Removes a gift, as if the owner deleted it. */
  removeItem(itemId: string): void
  /** Fail the next call. `applied: true` simulates a lost response: the server did the work. */
  failNext(method: Method, code: ApiErrorCode, options?: { applied?: boolean }): void
}

/** A stateful stand-in for the public-wishlist and reservation Edge Functions. */
export function createFakeReservationBackend(
  token: string,
  list: PublicWishlist,
): FakeReservationBackend {
  const holders = new Map<string, string>()
  const calls: FakeReservationBackend['calls'] = []
  const failures = new Map<Method, { code: ApiErrorCode; applied: boolean }>()
  const requests: string[] = []
  let revoked = false
  let items = list.items

  const knows = (shareToken: string, itemId: string) =>
    shareToken === token && !revoked && items.some((item) => item.id === itemId)

  function applyReserve(itemId: string, secret: string) {
    const holder = holders.get(itemId)
    if (holder && holder !== secret) throw new ApiError('RESERVATION_CONFLICT')
    holders.set(itemId, secret)
  }
  function applyCancel(itemId: string, secret: string) {
    const holder = holders.get(itemId)
    if (holder && holder !== secret) throw new ApiError('NOT_RESERVATION_OWNER')
    holders.delete(itemId)
  }
  const fail = (method: Method, apply: () => void) => {
    const failure = failures.get(method)
    if (!failure) return
    failures.delete(method)
    if (failure.applied) apply()
    throw new ApiError(failure.code)
  }

  return {
    holders,
    calls,
    revoke: () => void (revoked = true),
    removeItem: (itemId) => void (items = items.filter((item) => item.id !== itemId)),
    failNext: (method, code, options) =>
      void failures.set(method, { code, applied: options?.applied ?? false }),

    publicRepository: {
      requests,
      async getPublicWishlist(shareToken) {
        requests.push(shareToken)
        if (shareToken !== token || revoked) throw new ApiError('NOT_FOUND')
        return {
          ...list,
          items: items.map((item) => ({ ...item, reserved: holders.has(item.id) })),
        }
      },
    },

    repository: {
      async reserve(shareToken, itemId, secret) {
        calls.push({ method: 'reserve', itemId, secret })
        fail('reserve', () => applyReserve(itemId, secret))
        if (!knows(shareToken, itemId)) throw new ApiError('NOT_FOUND')
        applyReserve(itemId, secret)
      },
      async cancel(shareToken, itemId, secret) {
        calls.push({ method: 'cancel', itemId, secret })
        fail('cancel', () => applyCancel(itemId, secret))
        if (!knows(shareToken, itemId)) throw new ApiError('NOT_FOUND')
        applyCancel(itemId, secret)
      },
      async getOwnedItemIds(shareToken, proofs: OwnershipProof[]) {
        calls.push({ method: 'getOwnedItemIds' })
        fail('getOwnedItemIds', () => undefined)
        if (shareToken !== token || revoked) throw new ApiError('NOT_FOUND')
        return proofs
          .filter(({ itemId, secret }) => holders.get(itemId) === secret)
          .map(({ itemId }) => itemId)
      },
    },
  }
}
