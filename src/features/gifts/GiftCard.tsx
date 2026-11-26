import { ExternalLink, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { currentLanguage } from '@/i18n'
import { formatCurrency } from '@/lib/formatting'
import type { Gift } from '@/features/wishlists/types'
import { GiftThumbnail } from './GiftThumbnail'

export function GiftCard({
  gift,
  reserved = false,
  onEdit,
  onDelete,
}: {
  gift: Gift
  reserved?: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation() // re-renders on language change
  const language = currentLanguage()

  return (
    <li className="flex gap-4 rounded-card bg-white p-4 shadow-sm ring-1 ring-black/5">
      <GiftThumbnail imageUrl={gift.image_url} />
      <div className="min-w-0 flex-1 space-y-1">
        <h3 className="wrap-anywhere font-semibold">{gift.title}</h3>
        {gift.price !== null && (
          <p className="text-sm font-medium text-brand">
            {formatCurrency(gift.price, gift.currency, language)}
          </p>
        )}
        {gift.description && (
          <p className="line-clamp-2 wrap-anywhere text-sm text-muted">{gift.description}</p>
        )}
        {reserved && (
          <p className="inline-block rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand">
            {t('gift.reservedBadge')}
          </p>
        )}
        {gift.product_url && (
          <a
            href={gift.product_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1 text-sm text-brand underline"
          >
            {t('gift.viewProduct')}
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </a>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <Button
          variant="ghost"
          className="min-w-11 px-3"
          aria-label={t('gift.editLabel', { title: gift.title })}
          onClick={onEdit}
        >
          <Pencil aria-hidden="true" className="size-4" />
        </Button>
        <Button
          variant="ghost"
          className="min-w-11 px-3"
          aria-label={t('gift.deleteLabel', { title: gift.title })}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </Button>
      </div>
    </li>
  )
}
