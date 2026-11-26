import { createContext } from 'react'
import type { AuthResult, AuthSession } from './types'

export interface AuthContextValue {
  /** `loading` until the stored session has been resolved. */
  status: 'loading' | 'ready'
  session: AuthSession | null
  /** False when no Supabase configuration is present. */
  configured: boolean
  signInWithGoogle(): Promise<AuthResult>
  signInWithMagicLink(email: string): Promise<AuthResult>
  signOut(): Promise<AuthResult>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
