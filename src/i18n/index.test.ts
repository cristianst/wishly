import i18n, {
  DEFAULT_LANGUAGE,
  LANGUAGE_STORAGE_KEY,
  getStoredLanguage,
  setLanguage,
  translate,
} from './index'

afterEach(async () => {
  vi.restoreAllMocks()
  await i18n.changeLanguage(DEFAULT_LANGUAGE)
})

describe('language selection', () => {
  it('defaults to English when nothing is stored, ignoring the browser language', () => {
    vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('de-DE')
    expect(getStoredLanguage()).toBe('en')
  })

  it('restores a previously stored language', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'es')
    expect(getStoredLanguage()).toBe('es')
  })

  it('ignores unsupported stored values', () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'fr')
    expect(getStoredLanguage()).toBe('en')
  })

  it('falls back to English when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(getStoredLanguage()).toBe('en')
  })

  it('still switches language when storage cannot be written', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    await setLanguage('de')
    expect(translate('common.cancel')).toBe('Abbrechen')
  })

  it('persists, translates and updates the document language', async () => {
    await setLanguage('es')
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('es')
    expect(document.documentElement.lang).toBe('es')
    expect(translate('common.cancel')).toBe('Cancelar')
  })
})
