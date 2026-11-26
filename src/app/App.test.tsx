import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n, { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY } from '@/i18n'
import { createFakeAuthClient } from '@/test/fakeAuthClient'
import { renderRoutes } from '@/test/renderRoutes'

afterEach(async () => {
  await i18n.changeLanguage(DEFAULT_LANGUAGE)
})

describe('app shell', () => {
  it('renders the landing page in English by default', () => {
    renderRoutes('/', createFakeAuthClient())
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Wishes worth sharing')
    expect(document.title).toBe('Wishly – Share your wishlist')
  })

  it('switches language without reload and persists the choice', async () => {
    const user = userEvent.setup()
    renderRoutes('/', createFakeAuthClient())

    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'de')

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Wünsche, die man gerne teilt',
    )
    expect(document.documentElement.lang).toBe('de')
    expect(document.title).toBe('Wishly – Teile deine Wunschliste')
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('de')
    expect(screen.getByRole('combobox', { name: 'Sprache' })).toBeInTheDocument()
  })

  it('shows a localized not-found page for unknown routes', async () => {
    renderRoutes('/does/not/exist', createFakeAuthClient())
    expect(await screen.findByRole('heading', { name: "We couldn't find that page" })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/')
  })
})
