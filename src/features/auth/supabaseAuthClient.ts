import {
  isAuthRetryableFetchError,
  type AuthError,
  type Session,
  type SupabaseClient,
} from '@supabase/supabase-js'
import type { AuthClient, AuthErrorCode, AuthResult, AuthSession } from './types'

function toSession(session: Session | null): AuthSession | null {
  return session ? { user: { id: session.user.id, email: session.user.email ?? null } } : null
}

function toResult(error: AuthError | null): AuthResult {
  if (!error) return { error: null }
  let code: AuthErrorCode = 'FAILED'
  if (error.status === 429) code = 'RATE_LIMITED'
  else if (isAuthRetryableFetchError(error)) code = 'NETWORK'
  return { error: code }
}

export function createSupabaseAuthClient(supabase: SupabaseClient): AuthClient {
  return {
    async getSession() {
      const { data } = await supabase.auth.getSession()
      return toSession(data.session)
    },
    onSessionChange(callback) {
      // The callback must stay synchronous: calling Supabase from inside it can deadlock.
      const { data } = supabase.auth.onAuthStateChange((_event, session) => {
        callback(toSession(session))
      })
      return () => data.subscription.unsubscribe()
    },
    async signInWithGoogle(redirectTo) {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      })
      return toResult(error)
    },
    async signInWithMagicLink(email, redirectTo, language) {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        // `data` is stored as user metadata when the account is created, so the email
        // templates can pick the user's language.
        options: { emailRedirectTo: redirectTo, shouldCreateUser: true, data: { language } },
      })
      return toResult(error)
    },
    async signOut() {
      const { error } = await supabase.auth.signOut()
      return toResult(error)
    },
  }
}
