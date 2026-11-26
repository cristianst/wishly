import { formatCurrency, formatDate, localeFor } from './formatting'

describe('formatting', () => {
  it('maps languages to the mandated locales', () => {
    expect(localeFor('en')).toBe('en-GB')
    expect(localeFor('es')).toBe('es-ES')
    expect(localeFor('de')).toBe('de-DE')
  })

  it('formats currency per locale without changing the amount', () => {
    expect(formatCurrency(1234.5, 'EUR', 'en')).toBe('€1,234.50')
    expect(formatCurrency(1234.5, 'EUR', 'de')).toMatch(/^1\.234,50\s€$/)
    expect(formatCurrency(1234.5, 'USD', 'es')).toContain('1234,50')
  })

  it('formats dates per locale', () => {
    const date = new Date(Date.UTC(2026, 2, 5, 12))
    expect(formatDate(date, 'en', { dateStyle: 'long', timeZone: 'UTC' })).toBe('5 March 2026')
    expect(formatDate(date, 'es', { dateStyle: 'long', timeZone: 'UTC' })).toBe(
      '5 de marzo de 2026',
    )
    expect(formatDate(date, 'de', { dateStyle: 'long', timeZone: 'UTC' })).toBe('5. März 2026')
  })
})
