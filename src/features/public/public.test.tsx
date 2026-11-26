import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n, { DEFAULT_LANGUAGE } from '@/i18n'
import { createFakeAuthClient } from '@/test/fakeAuthClient'
import { createFakePublicRepository, samplePublicGift } from '@/test/fakePublicRepository'
import { createFakeWishlistRepository } from '@/test/fakeWishlistRepository'
import { renderRoutes } from '@/test/renderRoutes'
import { createSupabasePublicWishlistRepository } from './repository'
import { publicWishlistSchema } from './types'

const TOKEN = 'a'.repeat(64)
const list = {
  title: 'Anna’s birthday',
  description: 'Things Anna likes',
  items: [
    samplePublicGift(),
    samplePublicGift({ id: 'g2', title: 'Book', price: null, productUrl: null, reserved: true }),
  ],
}

const renderShared = (
  path: string,
  repository = createFakePublicRepository({ [TOKEN]: list }),
) => ({
  repository,
  ...renderRoutes(
    path,
    createFakeAuthClient(null),
    undefined,
    createFakeWishlistRepository(),
    repository,
  ),
})

afterEach(async () => {
  await i18n.changeLanguage(DEFAULT_LANGUAGE)
})

describe('public wishlist page', () => {
  it('shows the list to a visitor who is not signed in', async () => {
    const { repository } = renderShared(`/l/${TOKEN}`)

    expect(await screen.findByRole('heading', { level: 1, name: 'Anna’s birthday' })).toBeVisible()
    expect(screen.getByText('Things Anna likes')).toBeVisible()
    expect(screen.getByText('Lamp')).toBeVisible()
    expect(screen.getByText('€49.00')).toBeVisible()
    expect(repository.requests).toEqual([TOKEN])
    expect(document.title).toBe('Anna’s birthday – Wishly')
  })

  it('opens merchant links safely and flags reserved gifts', async () => {
    renderShared(`/l/${TOKEN}`)
    const link = await screen.findByRole('link', { name: /View product/ })
    expect(link).toHaveAttribute('href', 'https://example.com/lamp')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getAllByText('Already reserved')).toHaveLength(1)
  })

  it('asks crawlers not to index the page, and stops when leaving it', async () => {
    const { router, unmount } = renderShared(`/l/${TOKEN}`)
    await screen.findByText('Lamp')
    expect(document.head.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    )
    await router.navigate('/')
    await waitFor(() => expect(document.head.querySelector('meta[name="robots"]')).toBeNull())
    unmount()
  })

  it('switches language independently of the creator and keeps their content untouched', async () => {
    const user = userEvent.setup()
    renderShared(`/l/${TOKEN}`)
    await screen.findByText('Lamp')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'de')

    expect(await screen.findByText('Bereits reserviert')).toBeVisible()
    expect(screen.getByText('Anna’s birthday', { selector: 'h1' })).toBeVisible()
    expect(screen.getByText(/49,00/)).toBeVisible()
  })

  it('shows one friendly page for unknown or rotated links', async () => {
    renderShared(`/l/${'z'.repeat(64)}`)
    expect(await screen.findByText('This wishlist isn’t available')).toBeVisible()
    expect(screen.queryByText(/zzzz/)).not.toBeInTheDocument()
  })

  it('reports rate limiting with a localized message and a retry', async () => {
    renderShared(`/l/${TOKEN}`, createFakePublicRepository({}, 'RATE_LIMITED'))
    expect(
      await screen.findByText('Too many requests. Please wait a moment and try again.'),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  it('handles an empty wishlist', async () => {
    renderShared(`/l/${TOKEN}`, createFakePublicRepository({ [TOKEN]: { ...list, items: [] } }))
    expect(await screen.findByText('No gifts here yet')).toBeVisible()
  })
})

describe('public wishlist data', () => {
  it('drops unsafe URLs and unexpected fields from the response', () => {
    const parsed = publicWishlistSchema.parse({
      title: 'x',
      description: null,
      secret: 'nope',
      items: [
        {
          ...samplePublicGift({ productUrl: 'javascript:alert(1)', imageUrl: 'data:text/html,x' }),
          claimHash: 'abc',
        },
      ],
    })
    expect(parsed.items[0]).toMatchObject({ productUrl: null, imageUrl: null })
    expect(JSON.stringify(parsed)).not.toMatch(/secret|claimHash/)
  })
})

describe('Supabase public repository', () => {
  const respond = (result: { data: unknown; error: unknown }) => {
    const calls: { name: string; body: Record<string, unknown> }[] = []
    const repository = createSupabasePublicWishlistRepository({
      invoke: async (name, options) => {
        calls.push({ name, body: options.body })
        return result
      },
    })
    return { repository, calls }
  }

  it('sends the token in the request body and validates the response', async () => {
    const { repository, calls } = respond({ data: { wishlist: list }, error: null })
    await expect(repository.getPublicWishlist(TOKEN)).resolves.toMatchObject({
      title: 'Anna’s birthday',
    })
    expect(calls).toEqual([{ name: 'public-wishlist', body: { token: TOKEN } }])
  })

  it.each([
    [new FunctionsHttpError(new Response(null, { status: 404 })), 'NOT_FOUND'],
    [new FunctionsHttpError(new Response(null, { status: 429 })), 'RATE_LIMITED'],
    [new FunctionsHttpError(new Response(null, { status: 500 })), 'UNKNOWN'],
    [new FunctionsFetchError(new TypeError('Failed to fetch')), 'NETWORK'],
    [new FunctionsRelayError(new Error('relay')), 'UNKNOWN'],
  ])('maps %s to %s', async (error, code) => {
    const { repository } = respond({ data: null, error })
    await expect(repository.getPublicWishlist(TOKEN)).rejects.toMatchObject({ code })
  })

  it('rejects malformed responses', async () => {
    const { repository } = respond({ data: { wishlist: { title: 1 } }, error: null })
    await expect(repository.getPublicWishlist(TOKEN)).rejects.toMatchObject({ code: 'UNKNOWN' })
  })
})
