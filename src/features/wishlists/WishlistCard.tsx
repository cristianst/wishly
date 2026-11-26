import { Gift } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import type { WishlistSummary } from './types'

export function WishlistCard({ wishlist }: { wishlist: WishlistSummary }) {
  const { t } = useTranslation()
  return (
    <li>
      <Link
        to={`/wishlists/${wishlist.id}/edit`}
        className="flex min-h-11 flex-col gap-2 rounded-card bg-white p-5 shadow-sm ring-1 ring-black/5 transition-shadow hover:shadow-md"
      >
        <span className="flex items-center gap-2 text-sm text-brand">
          <Gift aria-hidden="true" className="size-4" />
          {t('wishlist.itemCount', { count: wishlist.itemCount })}
        </span>
        <span className="wrap-anywhere text-lg font-semibold">{wishlist.title}</span>
        {wishlist.description && (
          <span className="line-clamp-2 wrap-anywhere text-sm text-muted">
            {wishlist.description}
          </span>
        )}
      </Link>
    </li>
  )
}
