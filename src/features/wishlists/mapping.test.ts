import { sampleGift } from '@/test/fakeWishlistRepository'
import { giftToFormValues, toGiftInput, toWishlistInput } from './mapping'

describe('mapping', () => {
  it('turns blank form fields into nulls', () => {
    expect(toWishlistInput({ title: 'A', description: '' })).toEqual({
      title: 'A',
      description: null,
    })
    expect(
      toGiftInput({
        title: 'G',
        description: '',
        productUrl: '',
        imageUrl: '',
        price: '',
        currency: 'EUR',
      }),
    ).toEqual({
      title: 'G',
      description: null,
      productUrl: null,
      imageUrl: null,
      price: null,
      currency: 'EUR',
    })
  })

  it('parses a localized price without inventing one', () => {
    const input = toGiftInput({
      title: 'G',
      description: '',
      productUrl: '',
      imageUrl: '',
      price: '12,50',
      currency: 'USD',
    })
    expect(input.price).toBe(12.5)
    expect(input.currency).toBe('USD')
  })

  it('round-trips a stored gift into form values', () => {
    expect(giftToFormValues(sampleGift({ price: null, description: null }))).toMatchObject({
      price: '',
      description: '',
      productUrl: 'https://example.com/p',
    })
  })
})
