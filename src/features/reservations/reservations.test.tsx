import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n, { DEFAULT_LANGUAGE } from '@/i18n'
import { createFakeAuthClient } from '@/test/fakeAuthClient'
import { createFakeReservationBackend } from '@/test/fakeReservationBackend'
import { samplePublicGift } from '@/test/fakePublicRepository'
import { createFakeWishlistRepository } from '@/test/fakeWishlistRepository'
import { renderRoutes } from '@/test/renderRoutes'
import { createSecretStore, type SecretStore } from './secrets'
import type { ReservationRepository } from './repository'

const TOKEN = 'a'.repeat(64)
const OTHER_SECRET = 'O'.repeat(43)
const LIST = {
  title: 'Anna’s birthday',
  description: null,
  items: [
    samplePublicGift({ id: 'g1', title: 'Lamp' }),
    samplePublicGift({ id: 'g2', title: 'Book', productUrl: null }),
  ],
}
const storedSecret = (itemId: string) => window.localStorage.getItem(`wishly:reservation:${itemId}`)

function setup(
  options: {
    secrets?: SecretStore
    repository?: (base: ReservationRepository) => ReservationRepository
  } = {},
) {
  const backend = createFakeReservationBackend(TOKEN, LIST)
  const secrets = options.secrets ?? createSecretStore()
  const repository = options.repository?.(backend.repository) ?? backend.repository
  const render = () =>
    renderRoutes(
      `/l/${TOKEN}`,
      createFakeAuthClient(null),
      undefined,
      createFakeWishlistRepository(),
      backend.publicRepository,
      {
        repository,
        secrets,
      },
    )
  return { backend, secrets, render, ...render() }
}

afterEach(async () => {
  await i18n.changeLanguage(DEFAULT_LANGUAGE)
})

describe('reserving', () => {
  it('offers every available gift to reserve', async () => {
    setup()
    expect(await screen.findAllByRole('button', { name: "I'll get this 🎁" })).toHaveLength(2)
  })

  it('stores the secret BEFORE sending the request, then confirms "Reserved by you"', async () => {
    const user = userEvent.setup()
    let storedAtRequestTime: string | null = null
    let sentSecret = ''
    const { backend } = setup({
      repository: (base) => ({
        ...base,
        reserve: async (token, itemId, secret) => {
          storedAtRequestTime = storedSecret(itemId)
          sentSecret = secret
          return base.reserve(token, itemId, secret)
        },
      }),
    })

    await user.click((await screen.findAllByRole('button', { name: "I'll get this 🎁" }))[0]!)

    expect(await screen.findByText('Reserved by you')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Cancel reservation' })).toBeVisible()
    expect(storedAtRequestTime).toBe(sentSecret)
    expect(sentSecret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(backend.holders.get('g1')).toBe(sentSecret)
    expect(storedSecret('g1')).toBe(sentSecret)
  })

  it('shows a disabled pending state and no success until the server answers', async () => {
    const user = userEvent.setup()
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    setup({
      repository: (base) => ({
        ...base,
        reserve: async (...args) => {
          await gate
          return base.reserve(...args)
        },
      }),
    })

    await user.click((await screen.findAllByRole('button', { name: "I'll get this 🎁" }))[0]!)
    const pending = await screen.findByRole('button', { name: 'Reserving…' })
    expect(pending).toBeDisabled()
    expect(screen.queryByText('Reserved by you')).not.toBeInTheDocument()

    release()
    expect(await screen.findByText('Reserved by you')).toBeVisible()
  })

  it('still recognises the reservation after a page reload', async () => {
    const user = userEvent.setup()
    const { backend, secrets, unmount } = setup()
    await user.click((await screen.findAllByRole('button', { name: "I'll get this 🎁" }))[0]!)
    await screen.findByText('Reserved by you')
    unmount()

    renderRoutes(
      `/l/${TOKEN}`,
      createFakeAuthClient(null),
      undefined,
      createFakeWishlistRepository(),
      backend.publicRepository,
      {
        repository: backend.repository,
        secrets,
      },
    )
    expect(await screen.findByText('Reserved by you')).toBeVisible()
    expect(backend.calls.some((call) => call.method === 'getOwnedItemIds')).toBe(true)
  })
})

describe('reservations held by someone else', () => {
  it('shows "Already reserved" with no way to cancel', async () => {
    const backend = createFakeReservationBackend(TOKEN, LIST)
    backend.holders.set('g1', OTHER_SECRET)
    renderRoutes(
      `/l/${TOKEN}`,
      createFakeAuthClient(null),
      undefined,
      createFakeWishlistRepository(),
      backend.publicRepository,
      {
        repository: backend.repository,
        secrets: createSecretStore(),
      },
    )

    expect(await screen.findByRole('button', { name: 'Already reserved' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Cancel reservation' })).not.toBeInTheDocument()
    expect(screen.queryByText('Reserved by you')).not.toBeInTheDocument()
    expect(backend.calls.filter((call) => call.method === 'getOwnedItemIds')).toHaveLength(0)
  })

  it('does not trust a stale local secret: it is verified server-side, then discarded', async () => {
    const backend = createFakeReservationBackend(TOKEN, LIST)
    backend.holders.set('g1', OTHER_SECRET) // someone else holds it now
    window.localStorage.setItem('wishly:reservation:g1', 'S'.repeat(43)) // our old, released secret
    renderRoutes(
      `/l/${TOKEN}`,
      createFakeAuthClient(null),
      undefined,
      createFakeWishlistRepository(),
      backend.publicRepository,
      {
        repository: backend.repository,
        secrets: createSecretStore(),
      },
    )

    expect(await screen.findByRole('button', { name: 'Already reserved' })).toBeDisabled()
    expect(screen.queryByText('Reserved by you')).not.toBeInTheDocument()
    await waitFor(() => expect(storedSecret('g1')).toBeNull())
    expect(backend.calls.some((call) => call.method === 'getOwnedItemIds')).toBe(true)
  })

  it('reports a conflict when someone else got there first, and forgets the secret', async () => {
    const user = userEvent.setup()
    const { backend } = setup()
    const reserveButtons = await screen.findAllByRole('button', { name: "I'll get this 🎁" })
    backend.holders.set('g1', OTHER_SECRET) // taken after this page loaded

    await user.click(reserveButtons[0]!)

    expect(await screen.findByText('Someone has already reserved this gift.')).toBeVisible()
    expect(storedSecret('g1')).toBeNull()
    expect(await screen.findByRole('button', { name: 'Already reserved' })).toBeDisabled()
  })
})

describe('cancelling', () => {
  it('releases the gift and forgets the secret', async () => {
    const user = userEvent.setup()
    const { backend } = setup()
    await user.click((await screen.findAllByRole('button', { name: "I'll get this 🎁" }))[0]!)
    await user.click(await screen.findByRole('button', { name: 'Cancel reservation' }))

    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: "I'll get this 🎁" })).toHaveLength(2),
    )
    expect(backend.holders.size).toBe(0)
    expect(storedSecret('g1')).toBeNull()
  })

  it('explains when the reservation belongs to another browser', async () => {
    const user = userEvent.setup()
    const { backend } = setup()
    await user.click((await screen.findAllByRole('button', { name: "I'll get this 🎁" }))[0]!)
    await screen.findByRole('button', { name: 'Cancel reservation' })
    backend.failNext('cancel', 'NOT_RESERVATION_OWNER')

    await user.click(screen.getByRole('button', { name: 'Cancel reservation' }))
    expect(await screen.findByText(/reserved from another browser or device/)).toBeVisible()
  })
})

describe('unreliable networks', () => {
  it('reconciles a lost response by asking the server, with no duplicate request', async () => {
    const user = userEvent.setup()
    const { backend } = setup()
    const buttons = await screen.findAllByRole('button', { name: "I'll get this 🎁" })
    backend.failNext('reserve', 'NETWORK', { applied: true }) // server reserved, reply was lost

    await user.click(buttons[0]!)

    expect(await screen.findByText('Reserved by you')).toBeVisible()
    expect(screen.queryByText(/could not reach the server/)).not.toBeInTheDocument()
    expect(backend.calls.filter((call) => call.method === 'reserve')).toHaveLength(1)
  })

  it('keeps the secret after an unconfirmed failure so a retry is idempotent', async () => {
    const user = userEvent.setup()
    const { backend } = setup()
    const buttons = await screen.findAllByRole('button', { name: "I'll get this 🎁" })
    backend.failNext('reserve', 'NETWORK') // nothing reached the server

    await user.click(buttons[0]!)
    expect(
      await screen.findByText(
        'We could not reach the server. Check your connection and try again.',
      ),
    ).toBeVisible()
    expect(storedSecret('g1')).not.toBeNull()
    expect(screen.queryByText('Reserved by you')).not.toBeInTheDocument()

    await user.click((await screen.findAllByRole('button', { name: "I'll get this 🎁" }))[0]!)
    expect(await screen.findByText('Reserved by you')).toBeVisible()
    const reserveCalls = backend.calls.filter((call) => call.method === 'reserve')
    expect(reserveCalls).toHaveLength(2)
    expect(reserveCalls[1]!.secret).toBe(reserveCalls[0]!.secret)
  })
})

describe('environment', () => {
  it('warns when storage is blocked but still lets the guest reserve', async () => {
    const user = userEvent.setup()
    setup({
      secrets: createSecretStore(() => {
        throw new Error('blocked')
      }),
    })
    expect(await screen.findByText(/blocking local storage/)).toBeVisible()
    await user.click((await screen.findAllByRole('button', { name: "I'll get this 🎁" }))[0]!)
    expect(await screen.findByText('Reserved by you')).toBeVisible()
  })

  it('is read-only when reservations are unavailable', async () => {
    const backend = createFakeReservationBackend(TOKEN, LIST)
    renderRoutes(
      `/l/${TOKEN}`,
      createFakeAuthClient(null),
      undefined,
      createFakeWishlistRepository(),
      backend.publicRepository,
      null,
    )
    expect(await screen.findByText('Lamp')).toBeVisible()
    expect(screen.queryByRole('button', { name: "I'll get this 🎁" })).not.toBeInTheDocument()
  })

  it('translates the reservation controls', async () => {
    const user = userEvent.setup()
    setup()
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Language' }), 'es')
    expect((await screen.findAllByRole('button', { name: 'Yo me encargo 🎁' })).length).toBe(2)
    await user.click(screen.getAllByRole('button', { name: 'Yo me encargo 🎁' })[0]!)
    expect(await screen.findByText('Reservado por ti')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Cancelar reserva' })).toBeVisible()
  })
})
