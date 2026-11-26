import { focusManager } from '@tanstack/react-query'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '@/lib/api'
import { LIVE_REFRESH_MS } from '@/lib/polling'
import { createFakeAuthClient, TEST_SESSION } from '@/test/fakeAuthClient'
import { samplePublicGift } from '@/test/fakePublicRepository'
import { createFakeReservationBackend } from '@/test/fakeReservationBackend'
import {
  createFakeWishlistRepository,
  sampleGift,
  sampleWishlist,
} from '@/test/fakeWishlistRepository'
import { renderRoutes } from '@/test/renderRoutes'
import { createSecretStore } from '@/features/reservations/secrets'
import type { PublicWishlistRepository } from './repository'

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

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

function setupGuest(wrap?: (base: PublicWishlistRepository) => PublicWishlistRepository) {
  const backend = createFakeReservationBackend(TOKEN, LIST)
  const publicRepository = wrap ? wrap(backend.publicRepository) : backend.publicRepository
  renderRoutes(
    `/l/${TOKEN}`,
    createFakeAuthClient(null),
    undefined,
    createFakeWishlistRepository(),
    publicRepository,
    { repository: backend.repository, secrets: createSecretStore() },
  )
  return backend
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})
afterEach(() => {
  focusManager.setFocused(undefined)
  vi.useRealTimers()
})

describe('quiet background refresh (guest page)', () => {
  it('picks up another guest’s reservation after 30 seconds, without remounting or loading states', async () => {
    const backend = setupGuest()
    const lamp = await screen.findByText('Lamp')
    expect(screen.getAllByRole('button', { name: "I'll get this 🎁" })).toHaveLength(2)

    backend.holders.set('g1', OTHER_SECRET)
    await advance(LIVE_REFRESH_MS + 500)

    expect(await screen.findByRole('button', { name: 'Already reserved' })).toBeDisabled()
    expect(screen.getByText('Lamp')).toBe(lamp) // same DOM node: nothing was torn down
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })

  it('does not refetch before the interval has passed', async () => {
    const backend = setupGuest()
    await screen.findByText('Lamp')
    const initial = backend.publicRepository.requests.length

    await advance(LIVE_REFRESH_MS - 2_000)
    expect(backend.publicRepository.requests.length).toBe(initial)

    await advance(3_000)
    await waitFor(() => expect(backend.publicRepository.requests.length).toBe(initial + 1))
  })

  it('pauses while the tab is hidden and catches up when it returns', async () => {
    const backend = setupGuest()
    await screen.findByText('Lamp')
    const initial = backend.publicRepository.requests.length

    act(() => focusManager.setFocused(false))
    await advance(LIVE_REFRESH_MS * 4)
    expect(backend.publicRepository.requests.length).toBe(initial)

    backend.holders.set('g2', OTHER_SECRET)
    act(() => focusManager.setFocused(true))
    expect(await screen.findByRole('button', { name: 'Already reserved' })).toBeVisible()
  })

  it('keeps the list on screen when a background refresh fails', async () => {
    let calls = 0
    setupGuest((base) => ({
      requests: [],
      async getPublicWishlist(token) {
        calls += 1
        if (calls === 2) throw new ApiError('NETWORK') // the first background refresh blips
        return base.getPublicWishlist(token)
      },
    }))
    const lamp = await screen.findByText('Lamp')

    await advance(LIVE_REFRESH_MS + 500)
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2))

    expect(screen.getByText('Lamp')).toBe(lamp)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(/could not reach the server/)).not.toBeInTheDocument()
  })

  it('shows the unavailable page, and stops polling, once the link is rotated', async () => {
    const backend = setupGuest()
    await screen.findByText('Lamp')

    backend.revoke()
    await advance(LIVE_REFRESH_MS + 500)
    expect(await screen.findByText('This wishlist isn’t available')).toBeVisible()

    const afterRevoke = backend.publicRepository.requests.length
    await advance(LIVE_REFRESH_MS * 3)
    expect(backend.publicRepository.requests.length).toBe(afterRevoke)
  })

  it('shows a gift the owner deleted disappearing', async () => {
    const backend = setupGuest()
    await screen.findByText('Book')
    backend.removeItem('g2')
    await advance(LIVE_REFRESH_MS + 500)
    await waitFor(() => expect(screen.queryByText('Book')).not.toBeInTheDocument())
    expect(screen.getByText('Lamp')).toBeVisible()
  })
})

describe('quiet background refresh (owner editor)', () => {
  it('updates reservation badges without disturbing a form being edited', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const repository = createFakeWishlistRepository({
      lists: [sampleWishlist()],
      gifts: [sampleGift(), sampleGift({ id: 'g2', title: 'Book' })],
    })
    renderRoutes(
      '/wishlists/list-a/edit',
      createFakeAuthClient(TEST_SESSION),
      undefined,
      repository,
    )

    await user.click(await screen.findByRole('button', { name: 'Edit Headphones' }))
    const name = screen.getByLabelText('Gift name')
    await user.clear(name)
    await user.type(name, 'Half-typed new na')

    repository.reservedIds.add('g2')
    await advance(LIVE_REFRESH_MS + 500)

    expect(await screen.findByText('Reserved by a guest')).toBeVisible()
    expect(screen.getByLabelText('Gift name')).toHaveValue('Half-typed new na')
    expect(screen.getByLabelText('Gift name')).toHaveFocus()
  })
})
