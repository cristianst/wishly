import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { currentLanguage, setLanguage, SUPPORTED_LANGUAGES, isLanguage } from '@/i18n'

export function LanguageSelector() {
  const { t, i18n } = useTranslation()
  const value = isLanguage(i18n.language) ? i18n.language : currentLanguage()

  return (
    <label className="relative inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-3 text-sm shadow-sm ring-1 ring-black/10">
      <Globe aria-hidden="true" className="size-4 text-muted" />
      <span className="sr-only">{t('language.label')}</span>
      <select
        className="min-h-11 cursor-pointer bg-transparent pr-1 outline-none"
        value={value}
        onChange={(event) => {
          const next = event.target.value
          if (isLanguage(next)) void setLanguage(next)
        }}
      >
        {SUPPORTED_LANGUAGES.map((language) => (
          <option key={language} value={language} lang={language}>
            {t(`language.${language}`, { lng: language })}
          </option>
        ))}
      </select>
    </label>
  )
}
