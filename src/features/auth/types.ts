import type { Language } from '@/i18n'

export interface AuthUser {
  id: string
  email: string | null
}

export interface AuthSession {
  user: AuthUser
}

/** Stable error codes; the UI maps them to localized messages (errors.auth.<code>). */
export type AuthErrorCode = 'RATE_LIMITED' | 'NETWORK' | 'FAILED' | 'NOT_CONFIGURED'

export interface AuthResult {
  error: AuthErrorCode | null
}

/** The slice of the auth backend the app depends on. Keeps UI independent of the SDK. */
export interface AuthClient {
  getSession(): Promise<AuthSession | null>
  onSessionChange(callback: (session: AuthSession | null) => void): () => void
  signInWithGoogle(redirectTo: string): Promise<AuthResult>
  signInWithMagicLink(email: string, redirectTo: string, language: Language): Promise<AuthResult>
  signOut(): Promise<AuthResult>
}
