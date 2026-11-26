import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n, { DEFAULT_LANGUAGE, setLanguage, type Language } from '@/i18n'
import { createSecretStore } from '@/features/reservations/secrets'
import { a11yViolations } from '@/test/a11y'
import { createFakeAuthClient, TEST_SESSION } from '@/test/fakeAuthClient'
import { createFakeProductImporter, importedShirt } from '@/test/fakeProductImporter'
import { samplePublicGift } from '@/test/fakePublicRepository'
import { createFakeReservationBackend } from '@/test/fakeReservationBackend'
import {
  createFakeWishlistRepository,
  sampleGift,
  sampleWishlist,
} from '@/test/fakeWishlistRepository'
import { renderRoutes } from '@/test/renderRoutes'

const TOKEN = 'a'.repeat(64)
const LANGUAGES: Language[] = ['en', 'es', 'de']

afterEach(async () => {
  await i18n.changeLanguage(DEFAULT_LANGUAGE)
})

/** Fails with a readable list of every violation axe finds in the whole document (dialogs included). */
async function expectAccessible() {
  expect(await a11yViolations(document.body), 'accessibility violations').toEqual([])
}

describe.each(LANGUAGES)('accessibility (%s)', (language) => {
  beforeEach(async () => {
    await setLanguage(language)
  })

  it('landing page', async () => {
    renderRoutes('/', createFakeAuthClient(null))
    await screen.findByRole('heading', { level: 1 })
    await expectAccessible()
  })

  it('login page, configured and unconfigured', async () => {
    const { unmount } = renderRoutes('/login', createFakeAuthClient(null))
    await screen.findByRole('heading', { level: 1 })
    await expectAccessible()
    unmount()

    renderRoutes('/login', null)
    await screen.findByRole('alert')
    await expectAccessible()
  })

  it('login form with a validation error', async () => {
    const user = userEvent.setup()
    renderRoutes('/login', createFakeAuthClient(null))
    await user.click(await screen.findByRole('button', { name: /link|enlace|Anmeldelink/i }))
    await screen.findAllByRole('alert')
    await expectAccessible()
  })

  it('privacy page', async () => {
    renderRoutes('/privacy', createFakeAuthClient(null))
    await screen.findByRole('heading', { level: 1 })
    await expectAccessible()
  })

  it('not-found page', async () => {
    renderRoutes('/nowhere', createFakeAuthClient(null))
    await screen.findByRole('heading', { level: 1 })
    await expectAccessible()
  })

  it('dashboard: empty and with wishlists', async () => {
    const empty = renderRoutes(
      '/dashboard',
      createFakeAuthClient(TEST_SESSION),
      undefined,
      createFakeWishlistRepository(),
    )
    await screen.findByRole('heading', { level: 2 })
    await expectAccessible()
    empty.unmount()

    renderRoutes(
      '/dashboard',
      createFakeAuthClient(TEST_SESSION),
      undefined,
      createFakeWishlistRepository({
        lists: [sampleWishlist(), sampleWishlist({ id: 'b', title: 'Wedding' })],
        gifts: [sampleGift()],
      }),
    )
    await screen.findByText('Wedding')
    await expectAccessible()
  })

  it('new wishlist form, including validation errors', async () => {
    const user = userEvent.setup()
    renderRoutes(
      '/wishlists/new',
      createFakeAuthClient(TEST_SESSION),
      undefined,
      createFakeWishlistRepository(),
    )
    const submit = await screen.findByRole('button', { name: /^(Create|Crear|Erstellen)$/ })
    await user.click(submit)
    await screen.findAllByRole('alert')
    await expectAccessible()
  })

  it('list editor with gifts, share section, add-gift form and import controls', async () => {
    const user = userEvent.setup()
    const repository = createFakeWishlistRepository({
      lists: [sampleWishlist()],
      gifts: [
        sampleGift(),
        sampleGift({
          id: 'g2',
          title: 'Book',
          image_url: 'https://img.example.com/b.jpg',
          description: 'A novel',
        }),
      ],
    })
    repository.reservedIds.add('g2')
    renderRoutes(
      '/wishlists/list-a/edit',
      createFakeAuthClient(TEST_SESSION),
      undefined,
      repository,
      null,
      null,
      createFakeProductImporter(() => importedShirt),
    )
    await screen.findByText('Book')
    await expectAccessible()

    await user.click(
      screen.getAllByRole('button')[
        screen
          .getAllByRole('button')
          .findIndex((b) => /add gift|añadir regalo|geschenk hinzufügen/i.test(b.textContent ?? ''))
      ]!,
    )
    await screen.findAllByRole('textbox')
    await expectAccessible()
  })

  it('confirmation dialogs', async () => {
    const user = userEvent.setup()
    renderRoutes(
      '/wishlists/list-a/edit',
      createFakeAuthClient(TEST_SESSION),
      undefined,
      createFakeWishlistRepository({ lists: [sampleWishlist()], gifts: [sampleGift()] }),
    )
    await screen.findByText('Headphones')
    // Each gift has Edit then Delete buttons; the second one opens the confirmation dialog.
    await user.click(screen.getAllByRole('button', { name: /Headphones/ })[1]!)
    await screen.findByRole('alertdialog')
    await expectAccessible()
  })

  it('guest wishlist: available, reserved by someone else, and mine', async () => {
    const backend = createFakeReservationBackend(TOKEN, {
      title: 'Anna’s birthday',
      description: 'Things Anna likes',
      items: [
        samplePublicGift({ id: 'g1', title: 'Lamp' }),
        samplePublicGift({
          id: 'g2',
          title: 'Book',
          productUrl: null,
          imageUrl: 'https://img.example.com/b.jpg',
        }),
        samplePublicGift({ id: 'g3', title: 'Plant', productUrl: null, price: null }),
      ],
    })
    backend.holders.set('g2', 'O'.repeat(43))
    const secrets = createSecretStore()
    secrets.set('g3', 'M'.repeat(43))
    backend.holders.set('g3', 'M'.repeat(43))
    renderRoutes(
      `/l/${TOKEN}`,
      createFakeAuthClient(null),
      undefined,
      createFakeWishlistRepository(),
      backend.publicRepository,
      { repository: backend.repository, secrets },
    )
    await screen.findByText('Lamp')
    await waitFor(() =>
      expect(
        screen.getByText(/Reserved by you|Reservado por ti|Von dir reserviert/),
      ).toBeInTheDocument(),
    )
    await expectAccessible()
  })

  it('guest page for an unavailable link', async () => {
    const backend = createFakeReservationBackend(TOKEN, {
      title: 'x',
      description: null,
      items: [],
    })
    renderRoutes(
      '/l/' + 'z'.repeat(64),
      createFakeAuthClient(null),
      undefined,
      createFakeWishlistRepository(),
      backend.publicRepository,
    )
    await screen.findByRole('heading', { level: 2 })
    await expectAccessible()
  })
})
