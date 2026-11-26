import { giftFormSchema, isHttpUrl, parsePrice, wishlistFormSchema } from './validation'

describe('parsePrice', () => {
  it.each([
    ['19.99', 19.99],
    ['19,99', 19.99],
    ['20', 20],
    ['0', 0],
  ])('accepts %s', (input, expected) => expect(parsePrice(input)).toBe(expected))

  it.each(['', '-1', '1,234.50', '1.234,50', 'abc', '1.999', '12345678901'])(
    'rejects %j',
    (input) => expect(parsePrice(input)).toBeNull(),
  )
})

describe('isHttpUrl', () => {
  it('only accepts http(s)', () => {
    expect(isHttpUrl('https://example.com/p?id=1')).toBe(true)
    expect(isHttpUrl('http://example.com')).toBe(true)
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpUrl('data:text/html,hi')).toBe(false)
    expect(isHttpUrl('example.com')).toBe(false)
    expect(isHttpUrl(`https://example.com/${'a'.repeat(2048)}`)).toBe(false)
  })
})

describe('form schemas', () => {
  it('trims and requires a wishlist title', () => {
    expect(wishlistFormSchema.parse({ title: '  Trip  ', description: '' }).title).toBe('Trip')
    const result = wishlistFormSchema.safeParse({ title: '   ', description: '' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('validation.titleRequired')
  })

  it('reports translation keys for invalid gift fields', () => {
    const result = giftFormSchema.safeParse({
      title: 'x',
      description: '',
      productUrl: 'ftp://nope',
      imageUrl: '',
      price: 'abc',
      currency: 'eur',
    })
    expect(result.error?.issues.map((issue) => issue.message).sort()).toEqual([
      'validation.currencyInvalid',
      'validation.priceInvalid',
      'validation.urlInvalid',
    ])
  })
})
