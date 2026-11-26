import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n, { DEFAULT_LANGUAGE } from '@/i18n'
import { createFakeAuthClient, TEST_SESSION } from '@/test/fakeAuthClient'
import {
  createFakeWishlistRepository,
  sampleGift,
  sampleWishlist,
} from '@/test/fakeWishlistRepository'
import { renderRoutes } from '@/test/renderRoutes'

const signedIn = () => createFakeAuthClient(TEST_SESSION)

afterEach(async () => {
  await i18n.changeLanguage(DEFAULT_LANGUAGE)
})

describe('dashboard', () => {
  it('shows an empty state with a create action', async () => {
    renderRoutes('/dashboard', signedIn(), undefined, createFakeWishlistRepository())
    expect(await screen.findByText('No wishlists yet')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Create wishlist' })).toHaveAttribute(
      'href',
      '/wishlists/new',
    )
  })

  it('lists wishlists with pluralized, localized gift counts', async () => {
    const repository = createFakeWishlistRepository({
      lists: [sampleWishlist(), sampleWishlist({ id: 'list-b', title: 'Wedding' })],
      gifts: [sampleGift(), sampleGift({ id: 'g2' })],
    })
    renderRoutes('/dashboard', signedIn(), undefined, repository)

    expect(await screen.findByText('2 gifts')).toBeVisible()
    expect(screen.getByText('0 gifts')).toBeVisible()
    expect(screen.getByRole('link', { name: /Birthday/ })).toHaveAttribute(
      'href',
      '/wishlists/list-a/edit',
    )

    await i18n.changeLanguage('de')
    expect(await screen.findByText('2 Geschenke')).toBeVisible()
  })

  it('shows a localized error and retries', async () => {
    const user = userEvent.setup()
    const repository = createFakeWishlistRepository({ lists: [sampleWishlist()] })
    repository.failNext('listWishlists', 'NETWORK')
    renderRoutes('/dashboard', signedIn(), undefined, repository)

    expect(
      await screen.findByText(
        'We could not reach the server. Check your connection and try again.',
      ),
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('link', { name: /Birthday/ })).toBeVisible()
  })
})

describe('create wishlist', () => {
  it('validates, creates and opens the editor', async () => {
    const user = userEvent.setup()
    const repository = createFakeWishlistRepository()
    const { router } = renderRoutes('/wishlists/new', signedIn(), undefined, repository)

    await user.click(await screen.findByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Enter a title.')).toBeVisible()
    expect(repository.lists).toHaveLength(0)

    await user.type(screen.getByLabelText('Title'), '  Christmas  ')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/wishlists\/.+\/edit$/))
    expect(repository.lists[0]).toMatchObject({ title: 'Christmas', description: null })
    expect(await screen.findByRole('heading', { level: 1, name: 'Christmas' })).toBeVisible()
  })
})

describe('edit wishlist', () => {
  const setup = (
    repository = createFakeWishlistRepository({ lists: [sampleWishlist()], gifts: [sampleGift()] }),
  ) => ({
    repository,
    ...renderRoutes('/wishlists/list-a/edit', signedIn(), undefined, repository),
  })

  it('shows a not-found state for lists the user does not own', async () => {
    renderRoutes(
      '/wishlists/someone-elses/edit',
      signedIn(),
      undefined,
      createFakeWishlistRepository(),
    )
    expect(await screen.findByText('Wishlist not found')).toBeVisible()
  })

  it('renders gifts with a formatted price and a safe external link', async () => {
    setup()
    expect(await screen.findByText('Headphones')).toBeVisible()
    expect(screen.getByText('€99.90')).toBeVisible()
    const link = screen.getByRole('link', { name: /View product/ })
    expect(link).toHaveAttribute('href', 'https://example.com/p')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('updates the list details', async () => {
    const user = userEvent.setup()
    const { repository } = setup()
    const title = await screen.findByLabelText('Title')
    await user.clear(title)
    await user.type(title, 'Birthday 2027')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Saved ✓')).toBeVisible()
    expect(repository.lists[0]?.title).toBe('Birthday 2027')
  })

  it('adds a gift manually, with optional fields left empty', async () => {
    const user = userEvent.setup()
    const { repository } = setup()
    await user.click(await screen.findByRole('button', { name: 'Add gift' }))
    await user.type(screen.getByLabelText('Gift name'), 'Book')
    await user.type(screen.getByLabelText('Price (optional)'), '12,50')
    await user.click(screen.getByRole('button', { name: 'Add gift', description: '' }))

    expect(await screen.findByText('Book')).toBeVisible()
    expect(repository.gifts.find((gift) => gift.title === 'Book')).toMatchObject({
      price: 12.5,
      currency: 'EUR',
      product_url: null,
      image_url: null,
    })
  })

  it('rejects invalid gift links and prices without calling the server', async () => {
    const user = userEvent.setup()
    const { repository } = setup()
    await user.click(await screen.findByRole('button', { name: 'Add gift' }))
    await user.type(screen.getByLabelText('Gift name'), 'Bad')
    await user.type(screen.getByLabelText('Product link (optional)'), 'javascript:alert(1)')
    await user.type(screen.getByLabelText('Price (optional)'), 'abc')
    await user.click(screen.getAllByRole('button', { name: 'Add gift' }).at(-1)!)

    expect(await screen.findByText('Enter a link starting with http:// or https://.')).toBeVisible()
    expect(screen.getByText('Enter an amount like 19.99.')).toBeVisible()
    expect(repository.gifts).toHaveLength(1)
  })

  it('edits an existing gift', async () => {
    const user = userEvent.setup()
    const { repository } = setup()
    await user.click(await screen.findByRole('button', { name: 'Edit Headphones' }))
    const name = screen.getAllByLabelText('Gift name')[0]!
    await user.clear(name)
    await user.type(name, 'Earbuds')
    const form = name.closest('form')!
    await user.click(within(form).getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Earbuds')).toBeVisible()
    expect(repository.gifts[0]?.title).toBe('Earbuds')
  })

  it('asks for confirmation before deleting a gift', async () => {
    const user = userEvent.setup()
    const { repository } = setup()
    await user.click(await screen.findByRole('button', { name: 'Delete Headphones' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(
      within(dialog).getByText('“Headphones” will be removed from the wishlist.'),
    ).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(repository.gifts).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Delete Headphones' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    )
    await waitFor(() => expect(repository.gifts).toHaveLength(0))
    expect(await screen.findByText('No gifts yet')).toBeVisible()
  })

  it('deletes the whole list after confirmation and returns to the dashboard', async () => {
    const user = userEvent.setup()
    const { repository, router } = setup()
    await user.click(await screen.findByRole('button', { name: 'Delete this wishlist' }))
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    )

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'))
    expect(repository.lists).toHaveLength(0)
    expect(repository.gifts).toHaveLength(0)
  })

  it('shows a localized message when saving fails', async () => {
    const user = userEvent.setup()
    const { repository } = setup()
    repository.failNext('updateWishlist', 'UNAUTHORIZED')
    await user.click(await screen.findByRole('button', { name: 'Save' }))
    expect(
      await screen.findByText('You are not allowed to do that. Try signing in again.'),
    ).toBeVisible()
  })
})
