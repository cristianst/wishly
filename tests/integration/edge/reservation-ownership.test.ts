import {
  handleReservationOwnership,
  type OwnershipDeps,
} from '../../../supabase/functions/reservation-ownership/handler'
import { sha256Hex } from '../../../supabase/functions/_shared/reservation'

const TOKEN = 'a'.repeat(64)
const ITEM_1 = '3f2b8f4e-6a1c-4d2e-9b7a-1c2d3e4f5a6b'
const ITEM_2 = '8c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f'
const SECRET = 'S'.repeat(43)

function deps(overrides: Partial<OwnershipDeps> = {}): OwnershipDeps {
  return {
    getOwnedItemIds: vi.fn(async () => [ITEM_1]),
    checkRateLimit: vi.fn(async () => true),
    ...overrides,
  }
}

const call = (body: unknown, method = 'POST') =>
  new Request('https://edge.test/reservation-ownership', {
    method,
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })

describe('POST /reservation-ownership', () => {
  it('returns the item ids the database confirms, hashing every secret first', async () => {
    const d = deps()
    const response = await handleReservationOwnership(
      call({
        shareToken: TOKEN,
        proofs: [
          { itemId: ITEM_1, reservationSecret: SECRET },
          { itemId: ITEM_2, reservationSecret: 'T'.repeat(43) },
        ],
      }),
      d,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ownedItemIds: [ITEM_1] })

    const [token, proofs] = vi.mocked(d.getOwnedItemIds).mock.calls[0]!
    expect(token).toBe(TOKEN)
    expect(proofs[0]).toEqual({ itemId: ITEM_1, claimHash: await sha256Hex(SECRET) })
    expect(JSON.stringify(proofs)).not.toContain(SECRET)
  })

  it('answers an empty batch without calling the database', async () => {
    const d = deps()
    const response = await handleReservationOwnership(call({ shareToken: TOKEN, proofs: [] }), d)
    expect(await response.json()).toEqual({ ownedItemIds: [] })
    expect(d.getOwnedItemIds).not.toHaveBeenCalled()
  })

  it('caps the batch size', async () => {
    const proofs = Array.from({ length: 51 }, () => ({ itemId: ITEM_1, reservationSecret: SECRET }))
    const d = deps()
    expect((await handleReservationOwnership(call({ shareToken: TOKEN, proofs }), d)).status).toBe(
      400,
    )
    expect(d.getOwnedItemIds).not.toHaveBeenCalled()
    const ok = Array.from({ length: 50 }, () => ({ itemId: ITEM_1, reservationSecret: SECRET }))
    expect(
      (await handleReservationOwnership(call({ shareToken: TOKEN, proofs: ok }), deps())).status,
    ).toBe(200)
  })

  it.each([
    ['proofs not an array', { shareToken: TOKEN, proofs: 'x' }, 400],
    ['null proof', { shareToken: TOKEN, proofs: [null] }, 400],
    [
      'bad item id',
      { shareToken: TOKEN, proofs: [{ itemId: 'x', reservationSecret: SECRET }] },
      400,
    ],
    [
      'weak secret',
      { shareToken: TOKEN, proofs: [{ itemId: ITEM_1, reservationSecret: 'abc' }] },
      400,
    ],
    ['malformed share token', { shareToken: 'nope', proofs: [] }, 404],
  ])('rejects %s', async (_name, body, status) => {
    const d = deps()
    expect((await handleReservationOwnership(call(body), d)).status).toBe(status)
    expect(d.getOwnedItemIds).not.toHaveBeenCalled()
  })

  it('rejects other methods and rate limits abusers', async () => {
    expect((await handleReservationOwnership(call({}, 'DELETE'), deps())).status).toBe(405)
    const limited = deps({ checkRateLimit: vi.fn(async () => false) })
    const response = await handleReservationOwnership(
      call({ shareToken: TOKEN, proofs: [] }),
      limited,
    )
    expect(response.status).toBe(429)
    expect(vi.mocked(limited.checkRateLimit).mock.calls[0]![0]).toMatch(
      /^reservation-ownership:[0-9a-f]{32}$/,
    )
  })

  it('hides internal failures and never leaks secrets', async () => {
    const log = vi.fn()
    const d = deps({
      getOwnedItemIds: vi.fn(async () => {
        throw new Error(`boom ${SECRET}`)
      }),
      log,
    })
    const response = await handleReservationOwnership(
      call({ shareToken: TOKEN, proofs: [{ itemId: ITEM_1, reservationSecret: SECRET }] }),
      d,
    )
    expect(response.status).toBe(500)
    expect((await response.text()) + JSON.stringify(log.mock.calls)).not.toContain(SECRET)
  })

  it('is private and uncacheable', async () => {
    const response = await handleReservationOwnership(
      call({ shareToken: TOKEN, proofs: [] }),
      deps(),
    )
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
})
