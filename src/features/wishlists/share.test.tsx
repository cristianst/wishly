import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createFakeAuthClient, TEST_SESSION } from '@/test/fakeAuthClient'
import {
  createFakeWishlistRepository,
  sampleGift,
  sampleWishlist,
} from '@/test/fakeWishlistRepository'
import { renderRoutes } from '@/test/renderRoutes'

function setup() {
  const repository = createFakeWishlistRepository({
    lists: [sampleWishlist()],
    gifts: [sampleGift()],
  })
  renderRoutes('/wishlists/list-a/edit', createFakeAuthClient(TEST_SESSION), undefined, repository)
  return repository
}

const linkInput = async () => (await screen.findByLabelText('Share link')) as HTMLInputElement

describe('share section', () => {
  it('shows the unlisted link for the list', async () => {
    const repository = setup()
    const input = await linkInput()
    expect(input.value).toBe(`${window.location.origin}/l/${repository.tokens['list-a']}`)
    expect(input).toHaveAttribute('readonly')
    expect(screen.getByRole('link', { name: 'Open shared page' })).toHaveAttribute(
      'rel',
      'noopener noreferrer',
    )
  })

  it('copies the link and confirms it', async () => {
    const user = userEvent.setup()
    setup()
    const input = await linkInput()
    await user.click(screen.getByRole('button', { name: 'Copy link' }))

    expect(await screen.findByText('Link copied ✓')).toBeVisible()
    expect(await navigator.clipboard.readText()).toBe(input.value)
  })

  it('falls back to manual copying when the clipboard is unavailable', async () => {
    const user = userEvent.setup()
    setup()
    await linkInput()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    await user.click(screen.getByRole('button', { name: 'Copy link' }))
    expect(await screen.findByText(/Could not copy automatically/)).toBeVisible()
  })

  it('warns before replacing the link, and keeps it when cancelled', async () => {
    const user = userEvent.setup()
    const repository = setup()
    const before = (await linkInput()).value

    await user.click(screen.getByRole('button', { name: 'Create a new link' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText(/will stop working immediately/)).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect((await linkInput()).value).toBe(before)
    expect(repository.tokens['list-a']).toBe(before.split('/l/')[1])
  })

  it('replaces the link after confirmation', async () => {
    const user = userEvent.setup()
    const repository = setup()
    const before = (await linkInput()).value

    await user.click(screen.getByRole('button', { name: 'Create a new link' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Create new link',
      }),
    )

    expect(await screen.findByText('New link created ✓')).toBeVisible()
    await waitFor(async () => expect((await linkInput()).value).not.toBe(before))
    expect((await linkInput()).value).toBe(
      `${window.location.origin}/l/${repository.tokens['list-a']}`,
    )
  })

  it('shows a localized error when the link cannot be replaced', async () => {
    const user = userEvent.setup()
    const repository = setup()
    await linkInput()
    repository.failNext('rotateShareToken', 'UNAUTHORIZED')

    await user.click(screen.getByRole('button', { name: 'Create a new link' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Create new link',
      }),
    )

    expect(
      await screen.findByText('You are not allowed to do that. Try signing in again.'),
    ).toBeVisible()
  })
})

describe('owner view of reservations', () => {
  it('flags reserved gifts without revealing who reserved them', async () => {
    const repository = createFakeWishlistRepository({
      lists: [sampleWishlist()],
      gifts: [sampleGift(), sampleGift({ id: 'g2', title: 'Book' })],
    })
    repository.reservedIds.add('g2')
    renderRoutes(
      '/wishlists/list-a/edit',
      createFakeAuthClient(TEST_SESSION),
      undefined,
      repository,
    )

    expect(await screen.findByText('Reserved by a guest')).toBeVisible()
    expect(screen.getAllByText('Reserved by a guest')).toHaveLength(1)
  })
})
