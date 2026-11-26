import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n, { DEFAULT_LANGUAGE } from '@/i18n'
import { createFakeAuthClient, TEST_SESSION } from '@/test/fakeAuthClient'
import { renderRoutes } from '@/test/renderRoutes'

afterEach(async () => {
  await i18n.changeLanguage(DEFAULT_LANGUAGE)
})

describe('protected routes', () => {
  it('redirects signed-out visitors to the login page', async () => {
    const { router } = renderRoutes('/dashboard', createFakeAuthClient(null))
    expect(await screen.findByRole('heading', { name: 'Welcome to Wishly' })).toBeVisible()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('shows the dashboard to signed-in creators', async () => {
    renderRoutes('/dashboard', createFakeAuthClient(TEST_SESSION))
    expect(await screen.findByRole('heading', { name: 'Your wishlists' })).toBeVisible()
  })

  it('sends signed-in users away from the login page', async () => {
    const { router } = renderRoutes('/login', createFakeAuthClient(TEST_SESSION))
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
  })

  it('ignores an unsafe return path after login', async () => {
    const { router } = renderRoutes('/login', createFakeAuthClient(TEST_SESSION), {
      from: 'https://evil.example',
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
  })

  it('signs the user out and returns them to the protected-route redirect', async () => {
    const user = userEvent.setup()
    const client = createFakeAuthClient(TEST_SESSION)
    const { router } = renderRoutes('/dashboard', client)

    await user.click(await screen.findByRole('button', { name: 'Sign out' }))

    expect(client.calls.signOut).toBe(1)
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
  })
})

describe('login page', () => {
  it('starts Google sign-in with the callback redirect', async () => {
    const user = userEvent.setup()
    const client = createFakeAuthClient(null)
    renderRoutes('/login', client)

    await user.click(await screen.findByRole('button', { name: 'Continue with Google' }))

    expect(client.calls.google).toEqual([`${window.location.origin}/auth/callback`])
  })

  it('sends a magic link and confirms by showing the address', async () => {
    const user = userEvent.setup()
    const client = createFakeAuthClient(null)
    renderRoutes('/login', client)

    await user.type(await screen.findByLabelText('Email address'), '  friend@example.com ')
    await user.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))

    expect(await screen.findByText(/friend@example\.com/)).toBeVisible()
    expect(client.calls.magicLink).toEqual([
      {
        email: 'friend@example.com',
        redirectTo: `${window.location.origin}/auth/callback`,
        language: 'en',
      },
    ])
  })

  it('sends the selected interface language with the magic-link request', async () => {
    const user = userEvent.setup()
    const client = createFakeAuthClient(null)
    renderRoutes('/login', client)

    await user.selectOptions(await screen.findByRole('combobox', { name: 'Language' }), 'es')
    await user.type(await screen.findByLabelText('Correo electrónico'), 'amigo@example.com')
    await user.click(screen.getByRole('button', { name: 'Envíame un enlace de acceso' }))

    await waitFor(() => expect(client.calls.magicLink[0]?.language).toBe('es'))
  })

  it('shows localized validation errors and does not call the server', async () => {
    const user = userEvent.setup()
    const client = createFakeAuthClient(null)
    renderRoutes('/login', client)

    await user.click(await screen.findByRole('button', { name: 'Email me a sign-in link' }))
    expect(await screen.findByText('Enter your email address.')).toBeVisible()

    await user.type(screen.getByLabelText('Email address'), 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
    expect(await screen.findByText('Enter a valid email address.')).toBeVisible()
    expect(client.calls.magicLink).toEqual([])
  })

  it('maps server error codes to localized messages', async () => {
    const user = userEvent.setup()
    const client = createFakeAuthClient(null, { magicLink: { error: 'RATE_LIMITED' } })
    renderRoutes('/login', client)

    await user.type(await screen.findByLabelText('Email address'), 'friend@example.com')
    await user.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))

    expect(
      await screen.findByText('Too many attempts. Please wait a moment and try again.'),
    ).toBeVisible()
  })

  it('reports missing configuration and disables sign-in', async () => {
    renderRoutes('/login', null)
    expect(
      await screen.findByText('Sign-in is not configured for this environment yet.'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Email me a sign-in link' })).toBeDisabled()
  })
})

describe('auth callback', () => {
  it('lands signed-in users on the remembered page', async () => {
    window.localStorage.setItem('wishly:auth-next', '/dashboard')
    const { router } = renderRoutes('/auth/callback', createFakeAuthClient(TEST_SESSION))
    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
  })

  it('shows a localized failure when the provider reports an error', async () => {
    renderRoutes('/auth/callback?error=access_denied', createFakeAuthClient(null))
    expect(await screen.findByRole('heading', { name: "We couldn't sign you in" })).toBeVisible()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
  })

  it('shows a failure when no session results', async () => {
    renderRoutes('/auth/callback', createFakeAuthClient(null))
    expect(await screen.findByRole('heading', { name: "We couldn't sign you in" })).toBeVisible()
  })
})
