import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/states'
import { GiftCard } from '@/features/gifts/GiftCard'
import { GiftForm } from '@/features/gifts/GiftForm'
import { ApiError } from '@/lib/api'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import {
  useCreateGift,
  useDeleteGift,
  useDeleteWishlist,
  useReservedItemIds,
  useUpdateGift,
  useUpdateWishlist,
  useWishlist,
} from './hooks'
import { giftToFormValues, toGiftInput, toWishlistInput } from './mapping'
import type { Gift } from './types'
import { ShareSection } from './ShareSection'
import { WishlistForm } from './WishlistForm'

function MutationError({ error }: { error: unknown }) {
  const { t } = useTranslation()
  if (!error) return null
  return (
    <p role="alert" className="text-sm text-red-700">
      {t(`errors.api.${error instanceof ApiError ? error.code : 'UNKNOWN'}`)}
    </p>
  )
}

export function EditWishlistPage() {
  const { t } = useTranslation()
  useDocumentTitle('meta.editWishlistTitle')
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const wishlist = useWishlist(id)
  const reservedIds = new Set(useReservedItemIds(id).data ?? [])
  const updateWishlist = useUpdateWishlist(id)
  const deleteWishlist = useDeleteWishlist(id)
  const createGift = useCreateGift(id)
  const updateGift = useUpdateGift(id)
  const deleteGift = useDeleteGift(id)

  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [giftToDelete, setGiftToDelete] = useState<Gift | null>(null)
  const [confirmDeleteList, setConfirmDeleteList] = useState(false)
  const [saved, setSaved] = useState(false)

  const backLink = (
    <Link
      to="/dashboard"
      className="inline-flex min-h-11 items-center text-sm text-brand underline"
    >
      {t('wishlist.backToDashboard')}
    </Link>
  )

  if (wishlist.isPending) {
    return (
      <div className="space-y-4 pt-8">
        <LoadingSkeleton />
      </div>
    )
  }
  // Keep showing what the owner is editing if a background refresh (e.g. on tab focus) fails.
  if (wishlist.error && !wishlist.data) {
    return (
      <div className="space-y-4 pt-8">
        {backLink}
        <ErrorState error={wishlist.error} onRetry={() => void wishlist.refetch()} />
      </div>
    )
  }
  if (wishlist.data === undefined) return null
  if (wishlist.data === null) {
    return (
      <div className="space-y-4 pt-8">
        {backLink}
        <EmptyState
          emoji="🔍"
          title={t('wishlist.notFoundTitle')}
          description={t('wishlist.notFoundDescription')}
        />
      </div>
    )
  }

  const { gifts, ...list } = wishlist.data

  return (
    <div className="space-y-10 pt-8">
      <div className="space-y-3">
        {backLink}
        <h1 className="wrap-anywhere text-3xl font-semibold tracking-tight">{list.title}</h1>
      </div>

      <section aria-labelledby="details-heading" className="max-w-lg space-y-4">
        <h2 id="details-heading" className="text-xl font-semibold">
          {t('wishlist.detailsHeading')}
        </h2>
        <WishlistForm
          initialValues={{ title: list.title, description: list.description ?? '' }}
          submitLabel={t('common.save')}
          pending={updateWishlist.isPending}
          onSubmit={(values) => {
            setSaved(false)
            updateWishlist.mutate(toWishlistInput(values), { onSuccess: () => setSaved(true) })
          }}
        />
        <MutationError error={updateWishlist.error} />
        {saved && !updateWishlist.error && (
          <p role="status" className="text-sm text-brand">
            {t('common.saved')}
          </p>
        )}
      </section>

      <ShareSection wishlistId={list.id} shareToken={list.shareToken} />

      <section aria-labelledby="gifts-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="gifts-heading" className="text-xl font-semibold">
            {t('gift.heading')}
          </h2>
          {!adding && (
            <Button variant="soft" onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" className="size-4" />
              {t('gift.add')}
            </Button>
          )}
        </div>

        {adding && (
          <div className="space-y-2">
            <GiftForm
              submitLabel={t('gift.addSubmit')}
              pending={createGift.isPending}
              onCancel={() => setAdding(false)}
              onSubmit={(values) =>
                createGift.mutate(toGiftInput(values), { onSuccess: () => setAdding(false) })
              }
            />
            <MutationError error={createGift.error} />
          </div>
        )}

        {gifts.length === 0 && !adding && (
          <EmptyState
            emoji="🎁"
            title={t('gift.emptyTitle')}
            description={t('gift.emptyDescription')}
          />
        )}

        {gifts.length > 0 && (
          <ul className="grid gap-4 lg:grid-cols-2">
            {gifts.map((gift) =>
              editingId === gift.id ? (
                <li key={gift.id} className="space-y-2 lg:col-span-2">
                  <GiftForm
                    initialValues={giftToFormValues(gift)}
                    submitLabel={t('common.save')}
                    pending={updateGift.isPending}
                    onCancel={() => setEditingId(null)}
                    onSubmit={(values) =>
                      updateGift.mutate(
                        { id: gift.id, input: toGiftInput(values) },
                        { onSuccess: () => setEditingId(null) },
                      )
                    }
                  />
                  <MutationError error={updateGift.error} />
                </li>
              ) : (
                <GiftCard
                  key={gift.id}
                  gift={gift}
                  reserved={reservedIds.has(gift.id)}
                  onEdit={() => {
                    updateGift.reset()
                    setEditingId(gift.id)
                  }}
                  onDelete={() => setGiftToDelete(gift)}
                />
              ),
            )}
          </ul>
        )}
        <MutationError error={deleteGift.error} />
      </section>

      <section aria-labelledby="danger-heading" className="max-w-lg space-y-3">
        <h2 id="danger-heading" className="text-xl font-semibold">
          {t('wishlist.dangerHeading')}
        </h2>
        <Button
          className="bg-red-700 hover:bg-red-700/90"
          onClick={() => {
            deleteWishlist.reset()
            setConfirmDeleteList(true)
          }}
        >
          {t('wishlist.delete')}
        </Button>
        <MutationError error={deleteWishlist.error} />
      </section>

      <ConfirmDialog
        open={giftToDelete !== null}
        onOpenChange={(open) => !open && setGiftToDelete(null)}
        title={t('gift.deleteTitle')}
        description={t('gift.deleteDescription', { title: giftToDelete?.title ?? '' })}
        confirmLabel={t('common.delete')}
        pending={deleteGift.isPending}
        onConfirm={() => {
          if (!giftToDelete) return
          deleteGift.mutate(giftToDelete.id, { onSettled: () => setGiftToDelete(null) })
        }}
      />
      <ConfirmDialog
        open={confirmDeleteList}
        onOpenChange={setConfirmDeleteList}
        title={t('wishlist.deleteTitle')}
        description={t('wishlist.deleteDescription', { title: list.title })}
        confirmLabel={t('common.delete')}
        pending={deleteWishlist.isPending}
        onConfirm={() =>
          deleteWishlist.mutate(undefined, {
            onSuccess: () => navigate('/dashboard', { replace: true }),
            onSettled: () => setConfirmDeleteList(false),
          })
        }
      />
    </div>
  )
}
