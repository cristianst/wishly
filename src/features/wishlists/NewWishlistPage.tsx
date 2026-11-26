import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { ApiError } from '@/lib/api'
import { useCreateWishlist } from './hooks'
import { toWishlistInput } from './mapping'
import { WishlistForm } from './WishlistForm'

export function NewWishlistPage() {
  const { t } = useTranslation()
  useDocumentTitle('meta.newWishlistTitle')
  const navigate = useNavigate()
  const create = useCreateWishlist()

  return (
    <div className="mx-auto max-w-lg space-y-6 pt-8">
      <Link
        to="/dashboard"
        className="inline-flex min-h-11 items-center text-sm text-brand underline"
      >
        {t('wishlist.backToDashboard')}
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">{t('wishlist.create')}</h1>
      <WishlistForm
        submitLabel={t('wishlist.createSubmit')}
        pending={create.isPending}
        onSubmit={(values) =>
          create.mutate(toWishlistInput(values), {
            onSuccess: (wishlist) => navigate(`/wishlists/${wishlist.id}/edit`),
          })
        }
      />
      {create.error && (
        <p role="alert" className="text-sm text-red-700">
          {t(`errors.api.${create.error instanceof ApiError ? create.error.code : 'UNKNOWN'}`)}
        </p>
      )}
    </div>
  )
}
