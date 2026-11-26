import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createFakeAuthClient } from '@/test/fakeAuthClient'
import { renderRoutes } from '@/test/renderRoutes'

describe('navigation accessibility', () => {
  it('does not steal focus or announce anything on the first load', async () => {
    renderRoutes('/', createFakeAuthClient(null))
    await screen.findByRole('heading', { level: 1 })
    expect(screen.getByRole('main')).not.toHaveFocus()
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(document.querySelector('[role="status"]')).toHaveTextContent('')
  })

  it('moves focus to the main content and announces the new page after navigating', async () => {
    const user = userEvent.setup()
    const { router } = renderRoutes('/', createFakeAuthClient(null))
    await user.click(await screen.findByRole('link', { name: 'Get started' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'))
    expect(screen.getByRole('main')).toHaveFocus()
    await waitFor(() =>
      expect(
        screen.getAllByRole('status').some((node) => node.textContent === 'Sign in – Wishly'),
      ).toBe(true),
    )
  })

  it('does not move focus when only the query string changes', async () => {
    const user = userEvent.setup()
    const { router } = renderRoutes('/login', createFakeAuthClient(null))
    const email = await screen.findByLabelText('Email address')
    await user.click(email)
    await router.navigate('/login?x=1')
    expect(email).toHaveFocus()
  })

  it('keeps the skip link working', async () => {
    renderRoutes('/', createFakeAuthClient(null))
    const skip = await screen.findByRole('link', { name: 'Skip to content' })
    expect(skip).toHaveAttribute('href', '#main')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main')
  })
})
