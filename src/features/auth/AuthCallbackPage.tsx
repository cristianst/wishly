import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { consumeNextPath } from './nextPath'
import { useAuth } from './useAuth'

/** Providers report failures as `error` in the query string or the URL fragment. */
function hasProviderError(search: string, hash: string): boolean {
  return (
    new URLSearchParams(search).has('error') ||
    new URLSearchParams(hash.replace(/^#/, '')).has('error')
  )
}

export function AuthCallbackPage() {
  const { t } = useTranslation()
  useDocumentTitle('meta.callbackTitle')
  const { status, session } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const failed = hasProviderError(location.search, location.hash)
  const signedIn = status === 'ready' && session !== null
  const rejected = !failed && status === 'ready' && session === null

  useEffect(() => {
    if (signedIn && !failed) navigate(consumeNextPath(), { replace: true })
  }, [signedIn, failed, navigate])

  if (failed || rejected) {
    return (
      <div className="mx-auto max-w-sm space-y-4 pt-16 text-center">
        <h1 className="text-2xl font-semibold">{t('auth.callbackFailedTitle')}</h1>
        <p role="alert" className="text-muted">
          {t('auth.callbackFailedBody')}
        </p>
        <Button asChild>
          <Link to="/login" replace>
            {t('auth.backToLogin')}
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <p role="status" className="pt-16 text-center text-muted">
      {t('auth.signingIn')}
    </p>
  )
}
