import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { currentLanguage } from '@/i18n'
import { AuthContext, type AuthContextValue } from './authContext'
import type { AuthClient, AuthResult, AuthSession } from './types'

interface AuthState {
  status: 'loading' | 'ready'
  session: AuthSession | null
}

export const AUTH_CALLBACK_PATH = '/auth/callback'

const NOT_CONFIGURED: AuthResult = { error: 'NOT_CONFIGURED' }

export function AuthProvider({
  client,
  children,
}: {
  client: AuthClient | null
  children: ReactNode
}) {
  const [state, setState] = useState<AuthState>({
    status: client ? 'loading' : 'ready',
    session: null,
  })
  const eventSeen = useRef(false)

  useEffect(() => {
    if (!client) return
    let active = true
    eventSeen.current = false

    const unsubscribe = client.onSessionChange((session) => {
      eventSeen.current = true
      setState({ status: 'ready', session })
    })
    void client
      .getSession()
      .catch(() => null)
      .then((session) => {
        // A change event is newer than the initial read, so it wins.
        if (active && !eventSeen.current) setState({ status: 'ready', session })
      })

    return () => {
      active = false
      unsubscribe()
    }
  }, [client])

  const value = useMemo<AuthContextValue>(() => {
    const redirectTo = () => `${window.location.origin}${AUTH_CALLBACK_PATH}`
    return {
      status: state.status,
      session: state.session,
      configured: client !== null,
      signInWithGoogle: () =>
        client ? client.signInWithGoogle(redirectTo()) : Promise.resolve(NOT_CONFIGURED),
      signInWithMagicLink: (email) =>
        client
          ? client.signInWithMagicLink(email, redirectTo(), currentLanguage())
          : Promise.resolve(NOT_CONFIGURED),
      signOut: () => (client ? client.signOut() : Promise.resolve(NOT_CONFIGURED)),
    }
  }, [client, state])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
