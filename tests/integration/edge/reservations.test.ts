import {
  RATE_LIMIT,
  handleReservations,
  type CancelOutcome,
  type ReservationDeps,
  type ReserveOutcome,
} from '../../../supabase/functions/reservations/handler'
import { sha256Hex } from '../../../supabase/functions/_shared/reservation'

const TOKEN = 'a'.repeat(64)
const ITEM = '3f2b8f4e-6a1c-4d2e-9b7a-1c2d3e4f5a6b'
const SECRET = 'S'.repeat(43)

function deps(overrides: Partial<ReservationDeps> = {}): ReservationDeps {
  return {
    reserve: vi.fn(async (): Promise<ReserveOutcome> => 'created'),
    cancel: vi.fn(async (): Promise<CancelOutcome> => 'cancelled'),
    checkRateLimit: vi.fn(async () => true),
    ...overrides,
  }
}

const call = (
  method: string,
  body: unknown = { shareToken: TOKEN, itemId: ITEM, reservationSecret: SECRET },
  init: RequestInit = {},
) =>
  new Request('https://edge.test/reservations', {
    method,
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  })

describe('POST /reservations', () => {
  it.each([
    ['created', 201, { status: 'reserved' }],
    ['already_yours', 200, { status: 'reserved' }],
    ['conflict', 409, { error: { code: 'RESERVATION_CONFLICT' } }],
    ['not_found', 404, { error: { code: 'NOT_FOUND' } }],
  ] as const)('maps %s to %i', async (outcome, status, body) => {
    const response = await handleReservations(
      call('POST'),
      deps({ reserve: vi.fn(async () => outcome) }),
    )
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual(body)
  })

  it('passes only the SHA-256 digest to the database, never the secret', async () => {
    const d = deps()
    await handleReservations(call('POST'), d)
    const [token, item, hash] = vi.mocked(d.reserve).mock.calls[0]!
    expect([token, item]).toEqual([TOKEN, ITEM])
    expect(hash).toBe(await sha256Hex(SECRET))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(vi.mocked(d.reserve).mock.calls)).not.toContain(SECRET)
  })

  it('never echoes the secret or its digest', async () => {
    const response = await handleReservations(call('POST'), deps())
    const text = await response.text()
    expect(text).not.toContain(SECRET)
    expect(text).not.toContain(await sha256Hex(SECRET))
  })
})

describe('DELETE /reservations', () => {
  it.each([
    ['cancelled', 200, { status: 'cancelled' }],
    ['none', 200, { status: 'cancelled' }],
    ['not_yours', 403, { error: { code: 'NOT_RESERVATION_OWNER' } }],
    ['not_found', 404, { error: { code: 'NOT_FOUND' } }],
  ] as const)('maps %s to %i', async (outcome, status, body) => {
    const response = await handleReservations(
      call('DELETE'),
      deps({ cancel: vi.fn(async () => outcome) }),
    )
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual(body)
  })

  it('hashes the secret before asking the database to cancel', async () => {
    const d = deps()
    await handleReservations(call('DELETE'), d)
    expect(vi.mocked(d.cancel).mock.calls[0]![2]).toBe(await sha256Hex(SECRET))
    expect(d.reserve).not.toHaveBeenCalled()
  })
})

describe('validation and abuse protection', () => {
  const bad: [string, unknown, number][] = [
    [
      'malformed share token',
      { shareToken: 'short', itemId: ITEM, reservationSecret: SECRET },
      404,
    ],
    ['missing item id', { shareToken: TOKEN, reservationSecret: SECRET }, 400],
    [
      'non-uuid item id',
      { shareToken: TOKEN, itemId: "1' or '1'='1", reservationSecret: SECRET },
      400,
    ],
    ['missing secret', { shareToken: TOKEN, itemId: ITEM }, 400],
    ['short (weak) secret', { shareToken: TOKEN, itemId: ITEM, reservationSecret: 'abc' }, 400],
    [
      'secret with illegal characters',
      { shareToken: TOKEN, itemId: ITEM, reservationSecret: `${'S'.repeat(42)}!` },
      400,
    ],
    [
      'oversized secret',
      { shareToken: TOKEN, itemId: ITEM, reservationSecret: 'S'.repeat(500) },
      400,
    ],
    ['non-string values', { shareToken: 1, itemId: 2, reservationSecret: 3 }, 404],
  ]

  it.each(bad)('rejects %s without touching the database', async (_name, body, status) => {
    const d = deps()
    for (const method of ['POST', 'DELETE']) {
      expect((await handleReservations(call(method, body), d)).status).toBe(status)
    }
    expect(d.reserve).not.toHaveBeenCalled()
    expect(d.cancel).not.toHaveBeenCalled()
  })

  it('rejects other methods, malformed JSON and oversized bodies', async () => {
    expect(
      (await handleReservations(new Request('https://edge.test/', { method: 'GET' }), deps()))
        .status,
    ).toBe(405)
    expect(
      (
        await handleReservations(
          new Request('https://edge.test/', { method: 'PUT', body: '{}' }),
          deps(),
        )
      ).status,
    ).toBe(405)
    expect((await handleReservations(call('POST', 'nope'), deps())).status).toBe(400)
    expect(
      (
        await handleReservations(
          call('POST', {
            shareToken: TOKEN,
            itemId: ITEM,
            reservationSecret: SECRET,
            pad: 'x'.repeat(6000),
          }),
          deps(),
        )
      ).status,
    ).toBe(400)
  })

  it('answers preflight for POST and DELETE', async () => {
    const response = await handleReservations(
      new Request('https://edge.test/', { method: 'OPTIONS' }),
      deps(),
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('access-control-allow-methods')).toMatch(
      /POST.*DELETE|DELETE.*POST/,
    )
  })

  it('rate limits before doing any work', async () => {
    const d = deps({ checkRateLimit: vi.fn(async () => false) })
    const response = await handleReservations(call('POST'), d)
    expect(response.status).toBe(429)
    expect(d.reserve).not.toHaveBeenCalled()
    const [key, limit, window] = vi.mocked(d.checkRateLimit).mock.calls[0]!
    expect(key).toMatch(/^reservations:[0-9a-f]{32}$/)
    expect([limit, window]).toEqual([RATE_LIMIT.limit, RATE_LIMIT.windowSeconds])
  })

  it('marks responses private and uncacheable', async () => {
    const response = await handleReservations(call('POST'), deps())
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
  })

  it('hides internal failures and never logs secrets or tokens', async () => {
    const log = vi.fn()
    const d = deps({
      reserve: vi.fn(async () => {
        throw new Error(`boom ${SECRET} ${TOKEN}`)
      }),
      log,
    })
    const response = await handleReservations(call('POST'), d)
    expect(response.status).toBe(500)
    const everything = (await response.text()) + JSON.stringify(log.mock.calls)
    expect(everything).not.toContain(SECRET)
    expect(everything).not.toContain(TOKEN)
  })

  it('treats an unexpected database answer as an internal error', async () => {
    const d = deps({ reserve: vi.fn(async () => 'surprise' as ReserveOutcome) })
    expect((await handleReservations(call('POST'), d)).status).toBe(500)
  })
})
