import { useTranslation } from 'react-i18next'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

const SECTIONS = ['collect', 'browser', 'providers', 'links', 'retention', 'rights'] as const

/** Only a plain email address is ever turned into a mailto link. */
const EMAIL = /^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[A-Za-z]{2,}$/

export function PrivacyPage() {
  const { t } = useTranslation()
  useDocumentTitle('meta.privacyTitle')
  const configured = import.meta.env.VITE_CONTACT_EMAIL?.trim()
  const contact = configured && EMAIL.test(configured) ? configured : null

  return (
    <article className="mx-auto max-w-2xl space-y-8 pt-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">{t('privacy.title')}</h1>
        <p className="text-muted">{t('privacy.intro')}</p>
      </header>

      {SECTIONS.map((id) => (
        <section key={id} aria-labelledby={`privacy-${id}`} className="space-y-2">
          <h2 id={`privacy-${id}`} className="text-xl font-semibold">
            {t(`privacy.${id}.title`)}
          </h2>
          <p className="text-ink">{t(`privacy.${id}.body`)}</p>
        </section>
      ))}

      {contact && (
        <p>
          {t('privacy.contact')}{' '}
          <a className="text-brand underline" href={`mailto:${contact}`}>
            {contact}
          </a>
        </p>
      )}
    </article>
  )
}
