import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import i18n, { DEFAULT_LANGUAGE } from '@/i18n'
import { createFakeAuthClient } from '@/test/fakeAuthClient'
import { renderRoutes } from '@/test/renderRoutes'

afterEach(async () => {
  vi.unstubAllEnvs()
  await i18n.changeLanguage(DEFAULT_LANGUAGE)
})

describe('privacy page', () => {
  it('is reachable from the footer on every page', async () => {
    const user = userEvent.setup()
    renderRoutes('/', createFakeAuthClient(null))
    await user.click(await screen.findByRole('link', { name: 'Privacy' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Privacy' })).toBeVisible()
    expect(document.title).toBe('Privacy – Wishly')
  })

  it('explains each topic the plan requires, with one heading per topic', async () => {
    renderRoutes('/privacy', createFakeAuthClient(null))
    for (const heading of [
      'What we store',
      'What stays in your browser',
      'Who processes data for us',
      'Shared links',
      'How long we keep data',
      'Your rights',
    ]) {
      expect(await screen.findByRole('heading', { level: 2, name: heading })).toBeVisible()
    }
  })

  it('is honest about what does not exist yet', async () => {
    renderRoutes('/privacy', createFakeAuthClient(null))
    expect(
      await screen.findByText(/Self-service account deletion is not available yet/),
    ).toBeVisible()
    expect(screen.getByText(/we store only a one-way hash/)).toBeVisible()
  })

  it('is translated', async () => {
    const user = userEvent.setup()
    renderRoutes('/privacy', createFakeAuthClient(null))
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Language' }), 'de')
    expect(await screen.findByRole('heading', { level: 1, name: 'Datenschutz' })).toBeVisible()
    expect(screen.getByRole('heading', { level: 2, name: 'Deine Rechte' })).toBeVisible()
  })

  it('shows the contact address only when one is configured and valid', async () => {
    vi.stubEnv('VITE_CONTACT_EMAIL', 'privacy@example.com')
    const { unmount } = renderRoutes('/privacy', createFakeAuthClient(null))
    expect(await screen.findByRole('link', { name: 'privacy@example.com' })).toHaveAttribute(
      'href',
      'mailto:privacy@example.com',
    )
    unmount()

    for (const value of [
      '',
      'not an email',
      'javascript:alert(1)',
      'a@b.c?subject=x',
      '"><img src=x>@e.com',
    ]) {
      vi.stubEnv('VITE_CONTACT_EMAIL', value)
      const view = renderRoutes('/privacy', createFakeAuthClient(null))
      await screen.findByRole('heading', { level: 1 })
      expect(screen.queryByText('Contact the operator:')).not.toBeInTheDocument()
      view.unmount()
    }
  })
})
