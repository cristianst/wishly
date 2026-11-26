import { z } from 'zod'
import { ApiError } from '@/lib/api'
import { toFunctionApiError, type FunctionInvoker } from '@/lib/functions'

export interface OwnershipProof {
  itemId: string
  secret: string
}

/** Anonymous reservation calls. Authorization is the secret the browser holds. */
export interface ReservationRepository {
  reserve(shareToken: string, itemId: string, secret: string): Promise<void>
  cancel(shareToken: string, itemId: string, secret: string): Promise<void>
  /** The item ids, among the supplied proofs, that the server confirms this browser holds. */
  getOwnedItemIds(shareToken: string, proofs: OwnershipProof[]): Promise<string[]>
}

const ownershipSchema = z.object({ ownedItemIds: z.array(z.string()) })

export function createSupabaseReservationRepository(
  functions: FunctionInvoker,
): ReservationRepository {
  return {
    async reserve(shareToken, itemId, secret) {
      const { error } = await functions.invoke('reservations', {
        method: 'POST',
        body: { shareToken, itemId, reservationSecret: secret },
      })
      if (error) throw toFunctionApiError(error)
    },
    async cancel(shareToken, itemId, secret) {
      const { error } = await functions.invoke('reservations', {
        method: 'DELETE',
        body: { shareToken, itemId, reservationSecret: secret },
      })
      if (error) throw toFunctionApiError(error)
    },
    async getOwnedItemIds(shareToken, proofs) {
      const { data, error } = await functions.invoke('reservation-ownership', {
        method: 'POST',
        body: {
          shareToken,
          proofs: proofs.map(({ itemId, secret }) => ({ itemId, reservationSecret: secret })),
        },
      })
      if (error) throw toFunctionApiError(error)
      const parsed = ownershipSchema.safeParse(data)
      if (!parsed.success) throw new ApiError('UNKNOWN')
      return parsed.data.ownedItemIds
    },
  }
}
