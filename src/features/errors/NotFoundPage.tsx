import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

export function NotFoundPage() {
  const { t } = useTranslation()
  useDocumentTitle('meta.notFoundTitle')

  return (
    <div className="mx-auto max-w-md space-y-4 pt-16 text-center">
      <p aria-hidden="true" className="text-5xl">
        🔍
      </p>
      <h1 className="text-2xl font-semibold">{t('notFound.title')}</h1>
      <p className="text-muted">{t('notFound.description')}</p>
      <Button asChild>
        <Link to="/">{t('notFound.home')}</Link>
      </Button>
    </div>
  )
}
