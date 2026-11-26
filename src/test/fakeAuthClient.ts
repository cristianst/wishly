import type { AuthClient, AuthResult, AuthSession } from '@/features/auth/types'

export interface FakeAuthClient extends AuthClient {
  emit(session: AuthSession | null): void
  calls: {
    google: string[]
    magicLink: { email: string; redirectTo: string; language: string }[]
    signOut: number
  }
}

export function createFakeAuthClient(
  initial: AuthSession | null = null,
  results: { google?: AuthResult; magicLink?: AuthResult } = {},
): FakeAuthClient {
  let current = initial
  const listeners = new Set<(session: AuthSession | null) => void>()
  const calls: FakeAuthClient['calls'] = { google: [], magicLink: [], signOut: 0 }

  return {
    calls,
    emit(session) {
      current = session
      listeners.forEach((listener) => listener(session))
    },
    getSession: () => Promise.resolve(current),
    onSessionChange(callback) {
      listeners.add(callback)
      return () => listeners.delete(callback)
    },
    signInWithGoogle(redirectTo) {
      calls.google.push(redirectTo)
      return Promise.resolve(results.google ?? { error: null })
    },
    signInWithMagicLink(email, redirectTo, language) {
      calls.magicLink.push({ email, redirectTo, language })
      return Promise.resolve(results.magicLink ?? { error: null })
    },
    signOut() {
      calls.signOut += 1
      this.emit(null)
      return Promise.resolve({ error: null })
    },
  }
}

export const TEST_SESSION: AuthSession = { user: { id: 'user-1', email: 'creator@example.com' } }
