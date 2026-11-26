import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/states'
import { GiftThumbnail } from '@/features/gifts/GiftThumbnail'
import { useReservations, type GiftReservationState } from '@/features/reservations/useReservations'
import { currentLanguage } from '@/i18n'
import { ApiError, type ApiErrorCode } from '@/lib/api'
import { formatCurrency } from '@/lib/formatting'
import { LIVE_REFRESH_MS, isNotFoundError } from '@/lib/polling'
import { useNoIndex } from '@/lib/useNoIndex'
import { usePublicWishlistRepository } from './repositoryContext'
import type { PublicGift } from './types'

function ReservationControl({
  state,
  pending,
  error,
  enabled,
  onReserve,
  onCancel,
}: {
  state: GiftReservationState
  pending: 'reserving' | 'cancelling' | undefined
  error: ApiErrorCode | undefined
  enabled: boolean
  onReserve: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()

  let control
  if (pending === 'reserving') {
    control = (
      <Button disabled aria-busy="true">
        {t('gift.reserving')}
      </Button>
    )
  } else if (pending === 'cancelling') {
    control = (
      <Button variant="soft" disabled aria-busy="true">
        {t('gift.cancelling')}
      </Button>
    )
  } else if (state === 'mine') {
    control = (
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand">
          {t('gift.reservedByYou')}
        </span>
        <Button variant="ghost" onClick={onCancel}>
          {t('gift.cancelReservation')}
        </Button>
      </div>
    )
  } else if (state === 'checking') {
    control = (
      <Button variant="soft" disabled aria-busy="true">
        {t('gift.checking')}
      </Button>
    )
  } else if (state === 'taken') {
    control = (
      <Button variant="soft" disabled>
        {t('public.alreadyReserved')}
      </Button>
    )
  } else if (enabled) {
    control = <Button onClick={onReserve}>{t('gift.reserve')}</Button>
  } else {
    control = null
  }

  return (
    <div className="space-y-1">
      {control}
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {t(`errors.api.${error}`)}
        </p>
      )}
    </div>
  )
}

function PublicGiftCard({ gift, control }: { gift: PublicGift; control: React.ReactNode }) {
  const { t } = useTranslation() // re-renders on language change
  return (
    <li className="flex gap-4 rounded-card bg-white p-4 shadow-sm ring-1 ring-black/5">
      <GiftThumbnail imageUrl={gift.imageUrl} />
      <div className="min-w-0 flex-1 space-y-1">
        <h2 className="wrap-anywhere font-semibold">{gift.title}</h2>
        {gift.price !== null && (
          <p className="text-sm font-medium text-brand">
            {formatCurrency(gift.price, gift.currency, currentLanguage())}
          </p>
        )}
        {gift.description && <p className="wrap-anywhere text-sm text-muted">{gift.description}</p>}
        {gift.productUrl && (
          <a
            href={gift.productUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1 text-sm text-brand underline"
          >
            {t('gift.viewProduct')}
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </a>
        )}
        {control}
      </div>
    </li>
  )
}

export function PublicWishlistPage() {
  const { t, i18n } = useTranslation()
  useNoIndex()
  const { shareToken = '' } = useParams()
  const repository = usePublicWishlistRepository()

  const query = useQuery({
    queryKey: ['public-wishlist', shareToken],
    queryFn: () => {
      if (!repository) throw new ApiError('UNKNOWN')
      return repository.getPublicWishlist(shareToken)
    },
    retry: false,
    // Quiet background refresh; stops once the link is known to be dead (unknown or rotated).
    refetchInterval: (current) => (isNotFoundError(current.state.error) ? false : LIVE_REFRESH_MS),
  })

  const items = query.data?.items ?? EMPTY_ITEMS
  const reservations = useReservations(shareToken, items)

  const title = query.data?.title
  const language = i18n.language
  useEffect(() => {
    document.title = title ? t('meta.sharedTitle', { title }) : t('meta.notFoundTitle')
  }, [t, title, language])

  if (query.isPending) {
    return (
      <div className="pt-8">
        <LoadingSkeleton />
      </div>
    )
  }

  // A failed background refresh must never replace a list the visitor is already looking at.
  // Only a missing/rotated link (or a failed first load) takes over the page.
  if (query.error && (!query.data || isNotFoundError(query.error))) {
    if (isNotFoundError(query.error)) {
      return (
        <div className="mx-auto max-w-md space-y-4 pt-16 text-center">
          <EmptyState
            emoji="🔍"
            title={t('public.unavailableTitle')}
            description={t('public.unavailableDescription')}
            action={
              <Button asChild>
                <Link to="/">{t('notFound.home')}</Link>
              </Button>
            }
          />
        </div>
      )
    }
    return (
      <div className="pt-8">
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    )
  }

  if (!query.data) return null
  const wishlist = query.data
  return (
    <div className="space-y-6 pt-8">
      <div className="max-w-2xl space-y-2">
        <h1 className="wrap-anywhere text-3xl font-semibold tracking-tight">{wishlist.title}</h1>
        {wishlist.description && <p className="wrap-anywhere text-muted">{wishlist.description}</p>}
      </div>

      {reservations.storageWarning && (
        <p role="alert" className="rounded-card bg-amber-50 p-4 text-sm text-amber-900">
          {t('public.storageWarning')}
        </p>
      )}

      {wishlist.items.length === 0 ? (
        <EmptyState
          emoji="🎁"
          title={t('public.emptyTitle')}
          description={t('public.emptyDescription')}
        />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {wishlist.items.map((gift) => (
            <PublicGiftCard
              key={gift.id}
              gift={gift}
              control={
                <ReservationControl
                  state={reservations.stateOf(gift)}
                  pending={reservations.pending[gift.id]}
                  error={reservations.errors[gift.id]}
                  enabled={reservations.enabled}
                  onReserve={() => void reservations.reserve(gift.id)}
                  onCancel={() => void reservations.cancel(gift.id)}
                />
              }
            />
          ))}
        </ul>
      )}
    </div>
  )
}

const EMPTY_ITEMS: PublicGift[] = []
