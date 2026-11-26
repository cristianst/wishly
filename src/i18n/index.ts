import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'

export const SUPPORTED_LANGUAGES = ['en', 'es', 'de'] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]

export const DEFAULT_LANGUAGE: Language = 'en'
export const LANGUAGE_STORAGE_KEY = 'wishly:language'

export const LOCALE_BY_LANGUAGE: Record<Language, string> = {
  en: 'en-GB',
  es: 'es-ES',
  de: 'de-DE',
}

export function isLanguage(value: unknown): value is Language {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
}

/** Reads the previously selected language. Never derived from the browser locale. */
export function getStoredLanguage(): Language {
  try {
    const stored = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    return isLanguage(stored) ? stored : DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}

function persistLanguage(language: Language): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  } catch {
    // Storage is unavailable: the selection simply applies to this session.
  }
}

export function syncDocumentLanguage(language: Language): void {
  document.documentElement.lang = language
}

void i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    de: { translation: de },
  },
  lng: getStoredLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: SUPPORTED_LANGUAGES,
  interpolation: { escapeValue: false },
  returnNull: false,
})

i18next.on('languageChanged', (language) => {
  if (isLanguage(language)) syncDocumentLanguage(language)
})
syncDocumentLanguage(getStoredLanguage())

export async function setLanguage(language: Language): Promise<void> {
  persistLanguage(language)
  await i18next.changeLanguage(language)
}

export function currentLanguage(): Language {
  return isLanguage(i18next.language) ? i18next.language : DEFAULT_LANGUAGE
}

/** Central translation helper for code that runs outside React components. */
export const translate = i18next.t.bind(i18next)

export default i18next
