import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PublicGift } from '@/features/public/types'
import { ApiError, type ApiErrorCode } from '@/lib/api'
import { LIVE_REFRESH_MS } from '@/lib/polling'
import { useReservationServices } from './context'
import { generateSecret } from './secrets'

export type GiftReservationState = 'available' | 'mine' | 'taken' | 'checking'
type PendingAction = 'reserving' | 'cancelling'

/** Outcomes where we cannot tell whether the server applied the request. */
const UNCONFIRMED: ApiErrorCode[] = ['NETWORK', 'UNKNOWN', 'RATE_LIMITED']

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key))
}

const codeOf = (error: unknown): ApiErrorCode =>
  error instanceof ApiError ? error.code : 'UNKNOWN'

export function useReservations(shareToken: string, items: PublicGift[]) {
  const services = useReservationServices()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<Record<string, PendingAction>>({})
  const [errors, setErrors] = useState<Record<string, ApiErrorCode>>({})
  const [storageWarning, setStorageWarning] = useState(
    () => services !== null && !services.secrets.isPersistent(),
  )

  // Only gifts that are reserved AND for which this browser remembers a secret need a server check.
  const candidateIds = useMemo(
    () =>
      services
        ? items.filter((item) => item.reserved && services.secrets.get(item.id)).map((i) => i.id)
        : [],
    [items, services],
  )

  const ownership = useQuery({
    queryKey: ['reservation-ownership', shareToken, candidateIds.join(',')],
    enabled: services !== null && candidateIds.length > 0,
    retry: false,
    refetchInterval: LIVE_REFRESH_MS,
    queryFn: () => {
      if (!services) return []
      const proofs = candidateIds.flatMap((itemId) => {
        const secret = services.secrets.get(itemId)
        return secret ? [{ itemId, secret }] : []
      })
      return services.repository.getOwnedItemIds(shareToken, proofs)
    },
  })

  const owned = useMemo(() => new Set(ownership.data ?? []), [ownership.data])

  // A remembered secret for a gift someone else holds is stale: forget it, so it can never
  // be mistaken for ownership later.
  useEffect(() => {
    if (!services || !ownership.data) return
    for (const id of candidateIds) {
      if (!ownership.data.includes(id) && !pending[id]) services.secrets.remove(id)
    }
  }, [services, ownership.data, candidateIds, pending])

  const refresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['public-wishlist', shareToken] }),
      queryClient.invalidateQueries({ queryKey: ['reservation-ownership', shareToken] }),
    ])
  }, [queryClient, shareToken])

  const run = useCallback(
    async (itemId: string, action: PendingAction, task: () => Promise<void>) => {
      setPending((current) => ({ ...current, [itemId]: action }))
      setErrors((current) => without(current, itemId))
      try {
        await task()
      } catch (error) {
        setErrors((current) => ({ ...current, [itemId]: codeOf(error) }))
      } finally {
        setPending((current) => without(current, itemId))
        await refresh()
      }
    },
    [refresh],
  )

  const reserve = useCallback(
    (itemId: string) => {
      if (!services) return Promise.resolve()
      return run(itemId, 'reserving', async () => {
        // Persist the secret BEFORE the request so a lost response never strands a reservation.
        const secret = services.secrets.get(itemId) ?? generateSecret()
        if (!services.secrets.set(itemId, secret)) setStorageWarning(true)

        try {
          await services.repository.reserve(shareToken, itemId, secret)
        } catch (error) {
          const code = codeOf(error)
          if (!UNCONFIRMED.includes(code)) {
            services.secrets.remove(itemId) // conflict / not found: definitely not ours
            throw error
          }
          // Outcome unknown: ask the server before showing success or failure.
          const confirmed = await services.repository
            .getOwnedItemIds(shareToken, [{ itemId, secret }])
            .then((ids) => ids.includes(itemId))
            .catch(() => false)
          if (!confirmed) throw error // keep the secret: a retry is idempotent
        }
      })
    },
    [services, run, shareToken],
  )

  const cancel = useCallback(
    (itemId: string) => {
      if (!services) return Promise.resolve()
      return run(itemId, 'cancelling', async () => {
        const secret = services.secrets.get(itemId)
        if (!secret) throw new ApiError('NOT_RESERVATION_OWNER')
        try {
          await services.repository.cancel(shareToken, itemId, secret)
          services.secrets.remove(itemId)
        } catch (error) {
          if (codeOf(error) === 'NOT_RESERVATION_OWNER' || codeOf(error) === 'NOT_FOUND') {
            services.secrets.remove(itemId)
          }
          throw error
        }
      })
    },
    [services, run, shareToken],
  )

  const stateOf = (item: PublicGift): GiftReservationState => {
    if (!item.reserved) return 'available'
    if (owned.has(item.id)) return 'mine'
    if (candidateIds.includes(item.id) && ownership.isPending) return 'checking'
    return 'taken'
  }

  return {
    enabled: services !== null,
    stateOf,
    pending,
    errors,
    reserve,
    cancel,
    storageWarning,
  }
}
