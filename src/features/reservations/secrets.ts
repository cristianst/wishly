const KEY_PREFIX = 'wishly:reservation:'

/** 256 bits from the Web Crypto CSPRNG, base64url-encoded (43 characters). */
export function generateSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface SecretStore {
  get(itemId: string): string | null
  /** Returns false when the secret could only be kept in memory (storage unavailable). */
  set(itemId: string, secret: string): boolean
  remove(itemId: string): void
  /** False when localStorage is unavailable, so cancelling may not survive leaving the page. */
  isPersistent(): boolean
}

/**
 * Holds the per-gift reservation secrets. They only ever live in this browser; the server
 * stores a hash. With no usable storage, secrets fall back to memory for the current page.
 */
export function createSecretStore(
  getStorage: () => Storage = () => window.localStorage,
): SecretStore {
  const memory = new Map<string, string>()

  const safe = <T>(action: (storage: Storage) => T, fallback: T): T => {
    try {
      return action(getStorage())
    } catch {
      return fallback
    }
  }

  return {
    get: (itemId) =>
      safe((s) => s.getItem(KEY_PREFIX + itemId), null) ?? memory.get(itemId) ?? null,
    set(itemId, secret) {
      const stored = safe((s) => {
        s.setItem(KEY_PREFIX + itemId, secret)
        return true
      }, false)
      if (!stored) memory.set(itemId, secret)
      return stored
    },
    remove(itemId) {
      memory.delete(itemId)
      safe((s) => s.removeItem(KEY_PREFIX + itemId), undefined)
    },
    isPersistent() {
      return safe((s) => {
        const probe = `${KEY_PREFIX}probe`
        s.setItem(probe, '1')
        s.removeItem(probe)
        return true
      }, false)
    },
  }
}
