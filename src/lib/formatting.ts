import { DEFAULT_LANGUAGE, LOCALE_BY_LANGUAGE, type Language } from '@/i18n'

export function localeFor(language: Language = DEFAULT_LANGUAGE): string {
  return LOCALE_BY_LANGUAGE[language]
}

/** Formats an amount in its own currency; the stored numeric value is never altered. */
export function formatCurrency(amount: number, currency: string, language: Language): string {
  return new Intl.NumberFormat(localeFor(language), { style: 'currency', currency }).format(amount)
}

export function formatDate(
  value: Date | string | number,
  language: Language,
  options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' },
): string {
  return new Intl.DateTimeFormat(localeFor(language), options).format(new Date(value))
}
