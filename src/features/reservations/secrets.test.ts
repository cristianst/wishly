import { createSecretStore, generateSecret } from './secrets'

describe('generateSecret', () => {
  it('produces 256 bits as 43 URL-safe characters', () => {
    const secret = generateSecret()
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const padded = secret.replace(/-/g, '+').replace(/_/g, '/') + '='
    expect(atob(padded)).toHaveLength(32)
  })

  it('never repeats', () => {
    expect(new Set(Array.from({ length: 200 }, generateSecret)).size).toBe(200)
  })
})

describe('createSecretStore', () => {
  it('persists secrets under a per-gift key', () => {
    const store = createSecretStore()
    expect(store.set('item-1', 'abc')).toBe(true)
    expect(window.localStorage.getItem('wishly:reservation:item-1')).toBe('abc')
    expect(store.get('item-1')).toBe('abc')
    store.remove('item-1')
    expect(store.get('item-1')).toBeNull()
    expect(window.localStorage.getItem('wishly:reservation:item-1')).toBeNull()
  })

  it('falls back to memory when storage is unavailable, and reports it', () => {
    const store = createSecretStore(() => {
      throw new Error('storage blocked')
    })
    expect(store.isPersistent()).toBe(false)
    expect(store.set('item-1', 'abc')).toBe(false)
    expect(store.get('item-1')).toBe('abc')
    store.remove('item-1')
    expect(store.get('item-1')).toBeNull()
  })

  it('reports persistent storage as available', () => {
    expect(createSecretStore().isPersistent()).toBe(true)
  })
})
