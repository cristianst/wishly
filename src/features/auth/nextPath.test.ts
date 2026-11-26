import { consumeNextPath, DEFAULT_NEXT_PATH, rememberNextPath, sanitizeNextPath } from './nextPath'

describe('sanitizeNextPath', () => {
  it('keeps safe in-app paths', () => {
    expect(sanitizeNextPath('/wishlists/abc/edit')).toBe('/wishlists/abc/edit')
    expect(sanitizeNextPath('/dashboard?tab=1')).toBe('/dashboard?tab=1')
  })

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    'dashboard',
    '/ok\nhttps://evil.example',
    '/login',
    '/auth/callback',
    42,
    null,
    undefined,
  ])('rejects %j', (value) => {
    expect(sanitizeNextPath(value)).toBe(DEFAULT_NEXT_PATH)
  })
})

describe('remembered next path', () => {
  it('is consumed exactly once', () => {
    rememberNextPath('/wishlists/abc/edit')
    expect(consumeNextPath()).toBe('/wishlists/abc/edit')
    expect(consumeNextPath()).toBe(DEFAULT_NEXT_PATH)
  })

  it('re-validates whatever is found in storage', () => {
    window.localStorage.setItem('wishly:auth-next', 'https://evil.example')
    expect(consumeNextPath()).toBe(DEFAULT_NEXT_PATH)
  })
})
