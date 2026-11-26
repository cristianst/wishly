import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/ui/states'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { useMyWishlists } from './hooks'
import { WishlistCard } from './WishlistCard'

export function DashboardPage() {
  const { t } = useTranslation()
  useDocumentTitle('meta.dashboardTitle')
  const { data, error, isPending, refetch } = useMyWishlists()

  const createButton = (
    <Button asChild>
      <Link to="/wishlists/new">
        <Plus aria-hidden="true" className="size-4" />
        {t('wishlist.create')}
      </Link>
    </Button>
  )

  return (
    <div className="space-y-6 pt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{t('dashboard.title')}</h1>
        {data && data.length > 0 && createButton}
      </div>

      {isPending && <LoadingSkeleton />}
      {error && !data && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.length === 0 && (
        <EmptyState
          emoji="🎈"
          title={t('dashboard.emptyTitle')}
          description={t('dashboard.emptyDescription')}
          action={createButton}
        />
      )}
      {data && data.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((wishlist) => (
            <WishlistCard key={wishlist.id} wishlist={wishlist} />
          ))}
        </ul>
      )}
    </div>
  )
}
