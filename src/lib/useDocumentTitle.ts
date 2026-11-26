import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

/** Sets a localized document title; re-runs when the language changes. */
export function useDocumentTitle(key: string): void {
  const { t, i18n } = useTranslation()
  const language = i18n.language

  useEffect(() => {
    document.title = t(key)
  }, [t, key, language])
}
