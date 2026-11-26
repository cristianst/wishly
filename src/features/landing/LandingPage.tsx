import { Link2, RefreshCw, Gift } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

const FEATURES = [
  { key: 'share', Icon: Link2 },
  { key: 'reserve', Icon: Gift },
  { key: 'live', Icon: RefreshCw },
] as const

export function LandingPage() {
  const { t } = useTranslation()
  useDocumentTitle('meta.landingTitle')

  return (
    <div className="space-y-12 pt-8 sm:pt-16">
      <section className="max-w-2xl space-y-4">
        <p className="text-sm font-medium text-brand">{t('landing.eyebrow')}</p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{t('landing.title')}</h1>
        <p className="text-lg text-muted">{t('landing.subtitle')}</p>
        <Button asChild>
          <Link to="/login">{t('landing.cta')}</Link>
        </Button>
      </section>
      <section aria-label={t('landing.featuresLabel')}>
        <ul className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map(({ key, Icon }) => (
            <li key={key} className="rounded-card bg-white p-5 shadow-sm ring-1 ring-black/5">
              <Icon aria-hidden="true" className="mb-3 size-6 text-brand" />
              <h2 className="font-semibold">{t(`landing.features.${key}.title`)}</h2>
              <p className="mt-1 text-sm text-muted">{t(`landing.features.${key}.description`)}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
