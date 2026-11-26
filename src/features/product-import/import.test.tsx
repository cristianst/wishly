import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '@/lib/api'
import i18n, { DEFAULT_LANGUAGE } from '@/i18n'
import { createFakeAuthClient, TEST_SESSION } from '@/test/fakeAuthClient'
import {
  createFakeProductImporter,
  importedShirt,
  type FakeProductImporter,
} from '@/test/fakeProductImporter'
import {
  createFakeWishlistRepository,
  sampleGift,
  sampleWishlist,
} from '@/test/fakeWishlistRepository'
import { renderRoutes } from '@/test/renderRoutes'
import { createSupabaseProductImporter } from './repository'

const LINK = 'https://www.otto.de/p/shirt-C1/?variationId=9#ech=1'

async function openAddGiftForm(importer: FakeProductImporter | null) {
  const user = userEvent.setup()
  const repository = createFakeWishlistRepository({
    lists: [sampleWishlist()],
    gifts: [sampleGift()],
  })
  renderRoutes(
    '/wishlists/list-a/edit',
    createFakeAuthClient(TEST_SESSION),
    undefined,
    repository,
    null,
    null,
    importer,
  )
  await user.click(await screen.findByRole('button', { name: 'Add gift' }))
  return { user, repository }
}

const linkField = () => screen.getByLabelText('Product link (optional)')
const importButton = () => screen.getByRole('button', { name: /Import details|Importing…/ })

afterEach(async () => {
  await i18n.changeLanguage(DEFAULT_LANGUAGE)
})

describe('importing product details', () => {
  it('fills the form, previews the image and title, and keeps everything editable', async () => {
    const importer = createFakeProductImporter(() => importedShirt)
    const { user, repository } = await openAddGiftForm(importer)

    await user.type(linkField(), LINK)
    await user.click(importButton())

    expect(
      await screen.findByText('Details imported. Check them and change anything you like.'),
    ).toBeVisible()
    expect(screen.getByLabelText('Gift name')).toHaveValue('adidas Real Madrid Heimtrikot')
    expect(screen.getByLabelText('Price (optional)')).toHaveValue('89.90')
    expect(screen.getByLabelText('Currency')).toHaveValue('EUR')
    expect(screen.getByLabelText('Image link (optional)')).toHaveValue(
      'https://img.example.com/shirt.jpg',
    )
    expect(screen.getByLabelText('Notes (optional)')).toHaveValue('Schmale Passform')

    const preview = screen.getByRole('figure', { name: 'Preview' })
    expect(within(preview).getByText('adidas Real Madrid Heimtrikot')).toBeVisible()
    const image = preview.querySelector('img')!
    expect(image).toHaveAttribute('src', 'https://img.example.com/shirt.jpg') // hotlinked, not copied
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer')

    // Edit before saving, then save: only the image LINK is stored.
    await user.clear(screen.getByLabelText('Gift name'))
    await user.type(screen.getByLabelText('Gift name'), 'Trikot (Größe M)')
    await user.click(screen.getByRole('button', { name: 'Add gift' }))
    await waitFor(() => expect(repository.gifts).toHaveLength(2))
    expect(repository.gifts[1]).toMatchObject({
      title: 'Trikot (Größe M)',
      image_url: 'https://img.example.com/shirt.jpg',
      product_url: LINK,
      price: 89.9,
      currency: 'EUR',
    })
  })

  it('sends the link exactly as typed, including variation parameters', async () => {
    const importer = createFakeProductImporter(() => importedShirt)
    const { user } = await openAddGiftForm(importer)
    await user.type(linkField(), LINK)
    await user.click(importButton())
    await screen.findByText(/Details imported/)
    expect(importer.calls).toEqual([LINK])
  })

  it('fills only what the page provided and never touches other fields', async () => {
    const importer = createFakeProductImporter(() => ({
      sourceUrl: LINK,
      extractionStatus: 'partial',
      title: 'Only a title',
    }))
    const { user } = await openAddGiftForm(importer)
    await user.type(screen.getByLabelText('Price (optional)'), '12,50')
    await user.type(screen.getByLabelText('Notes (optional)'), 'my note')
    await user.type(linkField(), LINK)
    await user.click(importButton())

    expect(await screen.findByText('We found some details. Please fill in the rest.')).toBeVisible()
    expect(screen.getByLabelText('Gift name')).toHaveValue('Only a title')
    expect(screen.getByLabelText('Price (optional)')).toHaveValue('12,50')
    expect(screen.getByLabelText('Notes (optional)')).toHaveValue('my note')
    expect(screen.queryByRole('figure', { name: 'Preview' })).not.toBeInTheDocument()
  })

  it('offers a currency the shop returned even if it is not in the usual list', async () => {
    const importer = createFakeProductImporter(() => ({ ...importedShirt, currency: 'NOK' }))
    const { user } = await openAddGiftForm(importer)
    await user.type(linkField(), LINK)
    await user.click(importButton())
    await screen.findByText(/Details imported/)
    expect(screen.getByLabelText('Currency')).toHaveValue('NOK')
  })

  it('explains a blocked shop and a failed read, and the form stays fully usable', async () => {
    const blocked = createFakeProductImporter(() => ({
      sourceUrl: LINK,
      extractionStatus: 'failed',
      failureReason: 'BLOCKED',
    }))
    const { user, repository } = await openAddGiftForm(blocked)
    await user.type(linkField(), LINK)
    await user.click(importButton())
    expect(
      await screen.findByText(
        'This shop doesn’t let us read its pages automatically. You can enter the details yourself.',
      ),
    ).toBeVisible()

    await user.type(screen.getByLabelText('Gift name'), 'Typed by hand')
    await user.click(screen.getByRole('button', { name: 'Add gift' }))
    await waitFor(() =>
      expect(repository.gifts.some((g) => g.title === 'Typed by hand')).toBe(true),
    )
  })

  it.each([
    ['NO_DATA', 'We couldn’t read details from that page. You can enter them yourself.'],
    ['UNREACHABLE', 'We couldn’t read details from that page. You can enter them yourself.'],
    ['NOT_HTML', 'We couldn’t read details from that page. You can enter them yourself.'],
  ] as const)('shows a generic message for %s', async (failureReason, message) => {
    const importer = createFakeProductImporter(() => ({
      sourceUrl: LINK,
      extractionStatus: 'failed',
      failureReason,
    }))
    const { user } = await openAddGiftForm(importer)
    await user.type(linkField(), LINK)
    await user.click(importButton())
    expect(await screen.findByText(message)).toBeVisible()
  })

  it.each([
    ['RATE_LIMITED', 'Too many requests. Please wait a moment and try again.'],
    ['UNAUTHORIZED', 'You are not allowed to do that. Try signing in again.'],
    ['NETWORK', 'We could not reach the server. Check your connection and try again.'],
    [
      'INVALID_URL',
      'Enter a link starting with http:// or https://. Private or internal addresses can’t be imported.',
    ],
    ['UNKNOWN', 'Something went wrong. Please try again.'],
  ] as const)(
    'shows a localized message for %s and keeps the form usable',
    async (code, message) => {
      const importer = createFakeProductImporter(() => new ApiError(code))
      const { user } = await openAddGiftForm(importer)
      await user.type(linkField(), LINK)
      await user.click(importButton())
      expect(await screen.findByText(message)).toBeVisible()
      expect(importButton()).toBeEnabled()
      await user.type(screen.getByLabelText('Gift name'), 'Still works')
      expect(screen.getByLabelText('Gift name')).toHaveValue('Still works')
    },
  )
})

describe('guards on the import button', () => {
  it('is disabled until a link is entered', async () => {
    const { user } = await openAddGiftForm(createFakeProductImporter(() => importedShirt))
    expect(importButton()).toBeDisabled()
    await user.type(linkField(), 'x')
    expect(importButton()).toBeEnabled()
  })

  it.each(['javascript:alert(1)', 'ftp://shop.example.com/x', 'not a link'])(
    'does not call the server for %j',
    async (value) => {
      const importer = createFakeProductImporter(() => importedShirt)
      const { user } = await openAddGiftForm(importer)
      await user.type(linkField(), value)
      await user.click(importButton())
      expect(
        await screen.findByText('Enter a link starting with http:// or https://.'),
      ).toBeVisible()
      expect(importer.calls).toHaveLength(0)
    },
  )

  it('shows a disabled pending state and no result until the server answers', async () => {
    const importer = createFakeProductImporter(() => importedShirt)
    const gate = importer.holdNext()
    const { user } = await openAddGiftForm(importer)
    await user.type(linkField(), LINK)
    await user.click(importButton())

    expect(await screen.findByRole('button', { name: 'Importing…' })).toBeDisabled()
    expect(screen.getByLabelText('Gift name')).toHaveValue('')

    act(() => gate.release(importedShirt))
    expect(await screen.findByText(/Details imported/)).toBeVisible()
  })

  it('ignores a late answer when the link was changed in the meantime', async () => {
    const importer = createFakeProductImporter(() => importedShirt)
    const gate = importer.holdNext()
    const { user } = await openAddGiftForm(importer)
    await user.type(linkField(), LINK)
    await user.click(importButton())
    await screen.findByRole('button', { name: 'Importing…' })

    await user.type(linkField(), '&other=1') // the visitor keeps editing
    act(() => gate.release(importedShirt))

    await waitFor(() => expect(importButton()).toHaveTextContent('Import details'))
    expect(screen.getByLabelText('Gift name')).toHaveValue('') // the stale result was not applied
    expect(screen.queryByText(/Details imported/)).not.toBeInTheDocument()
  })

  it('has no import button when importing is unavailable', async () => {
    await openAddGiftForm(null)
    expect(screen.queryByRole('button', { name: 'Import details' })).not.toBeInTheDocument()
    expect(linkField()).toBeVisible() // the manual form is unaffected
  })
})

describe('image preview', () => {
  it('previews a manually pasted image link too, and explains when the shop blocks it', async () => {
    const { user } = await openAddGiftForm(null)
    await user.type(screen.getByLabelText('Image link (optional)'), 'https://img.example.com/x.jpg')
    const preview = screen.getByRole('figure', { name: 'Preview' })
    fireEvent.error(preview.querySelector('img')!)
    expect(await screen.findByText(/image couldn’t be loaded/)).toBeVisible()
    expect(screen.getByText(/We only save the link to the image/)).toBeVisible()
  })

  it('never previews a non-http image link', async () => {
    const { user } = await openAddGiftForm(null)
    await user.type(screen.getByLabelText('Image link (optional)'), 'javascript:alert(1)')
    expect(screen.queryByRole('figure', { name: 'Preview' })).not.toBeInTheDocument()
  })
})

describe('translations', () => {
  it('translates the import controls', async () => {
    const importer = createFakeProductImporter(() => importedShirt)
    const { user } = await openAddGiftForm(importer)
    await user.selectOptions(screen.getByRole('combobox', { name: 'Language' }), 'de')
    await user.type(screen.getByLabelText('Produktlink (optional)'), LINK)
    await user.click(screen.getByRole('button', { name: 'Details importieren' }))
    expect(
      await screen.findByText('Details importiert. Prüfe sie und ändere, was du möchtest.'),
    ).toBeVisible()
    expect(screen.getByRole('figure', { name: 'Vorschau' })).toBeVisible()
  })
})

describe('Supabase product importer', () => {
  const http = (status: number) => new FunctionsHttpError(new Response(null, { status }))
  const respond = (result: { data: unknown; error: unknown }) => {
    const calls: { name: string; body: Record<string, unknown> }[] = []
    const importer = createSupabaseProductImporter({
      invoke: async (name, options) => {
        calls.push({ name, body: options.body })
        return result
      },
    })
    return { importer, calls }
  }

  it('sends only the URL and validates the response', async () => {
    const { importer, calls } = respond({ data: importedShirt, error: null })
    await expect(importer.importFromUrl(LINK)).resolves.toMatchObject({
      title: 'adidas Real Madrid Heimtrikot',
      price: 89.9,
    })
    expect(calls).toEqual([{ name: 'product-metadata', body: { url: LINK } }])
  })

  it('re-validates untrusted fields: unsafe image links, bad currencies and extras are dropped', async () => {
    const { importer } = respond({
      data: {
        ...importedShirt,
        imageUrl: 'javascript:alert(1)',
        currency: 'euro',
        price: -3,
        secret: 'x',
      },
      error: null,
    })
    await expect(importer.importFromUrl(LINK)).rejects.toMatchObject({ code: 'UNKNOWN' }) // invalid price/currency: reject the whole answer
    const { importer: lenient } = respond({
      data: { ...importedShirt, imageUrl: 'data:text/html,x', secret: 'x' },
      error: null,
    })
    const result = await lenient.importFromUrl(LINK)
    expect(result.imageUrl).toBeUndefined()
    expect(result).not.toHaveProperty('secret')
  })

  it.each([
    [http(400), 'INVALID_URL'],
    [http(401), 'UNAUTHORIZED'],
    [http(429), 'RATE_LIMITED'],
    [http(500), 'UNKNOWN'],
    [new FunctionsFetchError(new TypeError('Failed to fetch')), 'NETWORK'],
    [new FunctionsRelayError(new Error('relay')), 'UNKNOWN'],
  ])('maps %s to %s', async (error, code) => {
    const { importer } = respond({ data: null, error })
    await expect(importer.importFromUrl(LINK)).rejects.toMatchObject({ code })
  })

  it('rejects a malformed response', async () => {
    const { importer } = respond({ data: { extractionStatus: 'maybe' }, error: null })
    await expect(importer.importFromUrl(LINK)).rejects.toMatchObject({ code: 'UNKNOWN' })
  })
})
