import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api'

export function EmptyState({
  emoji,
  title,
  description,
  action,
}: {
  emoji: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="space-y-3 rounded-card bg-white p-8 text-center shadow-sm ring-1 ring-black/5">
      <p aria-hidden="true" className="text-4xl">
        {emoji}
      </p>
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && <p className="text-muted">{description}</p>}
      {action}
    </div>
  )
}

export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  const { t } = useTranslation()
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <span className="sr-only">{t('common.loading')}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          aria-hidden="true"
          className="h-24 animate-pulse rounded-card bg-black/5"
        />
      ))}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation()
  const code = error instanceof ApiError ? error.code : 'UNKNOWN'
  return (
    <div role="alert" className="space-y-3 rounded-card bg-red-50 p-6 text-center text-red-900">
      <p>{t(`errors.api.${code}`)}</p>
      {onRetry && (
        <Button variant="soft" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  )
}
