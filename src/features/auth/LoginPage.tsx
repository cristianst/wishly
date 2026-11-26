import { zodResolver } from '@hookform/resolvers/zod'
import { Mail } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Navigate, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { loginFormSchema, type LoginFormValues } from '@/lib/validation'
import { rememberNextPath, sanitizeNextPath } from './nextPath'
import type { AuthErrorCode } from './types'
import { useAuth } from './useAuth'

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5">
      <path
        fill="#4285F4"
        d="M22.5 12.27c0-.8-.07-1.56-.2-2.3H12v4.35h5.9a5.05 5.05 0 0 1-2.19 3.31v2.75h3.54c2.07-1.9 3.25-4.71 3.25-8.11Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.67l-3.54-2.75c-.98.66-2.24 1.05-3.74 1.05-2.87 0-5.3-1.94-6.17-4.55H2.17v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.83 14.08a6.6 6.6 0 0 1 0-4.16V7.08H2.17a11 11 0 0 0 0 9.84l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.07.56 4.21 1.65l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.17 7.08l3.66 2.84C6.7 7.32 9.13 5.38 12 5.38Z"
      />
    </svg>
  )
}

export function LoginPage() {
  const { t } = useTranslation()
  useDocumentTitle('meta.loginTitle')
  const { status, session, configured, signInWithGoogle, signInWithMagicLink } = useAuth()
  const location = useLocation()
  const nextPath = sanitizeNextPath((location.state as { from?: unknown } | null)?.from)

  const [pending, setPending] = useState<'google' | 'email' | null>(null)
  const [error, setError] = useState<AuthErrorCode | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: '' },
  })

  if (status === 'ready' && session) return <Navigate to={nextPath} replace />

  const disabled = !configured || pending !== null

  const onGoogle = async () => {
    setError(null)
    setPending('google')
    rememberNextPath(nextPath)
    const result = await signInWithGoogle()
    // On success the browser leaves for Google, so only failures return here.
    setPending(null)
    if (result.error) setError(result.error)
  }

  const onEmail = handleSubmit(async ({ email }) => {
    setError(null)
    setPending('email')
    rememberNextPath(nextPath)
    const result = await signInWithMagicLink(email)
    setPending(null)
    if (result.error) setError(result.error)
    else setSentTo(email)
  })

  return (
    <div className="mx-auto max-w-sm space-y-6 pt-10 sm:pt-16">
      <div className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">{t('auth.loginTitle')}</h1>
        <p className="text-muted">{t('auth.loginSubtitle')}</p>
      </div>

      {!configured && (
        <p role="alert" className="rounded-card bg-amber-50 p-4 text-sm text-amber-900">
          {t('errors.auth.NOT_CONFIGURED')}
        </p>
      )}

      {sentTo ? (
        <div
          role="status"
          className="space-y-4 rounded-card bg-white p-5 shadow-sm ring-1 ring-black/5"
        >
          <Mail aria-hidden="true" className="size-6 text-brand" />
          <h2 className="font-semibold">{t('auth.checkInboxTitle')}</h2>
          <p className="text-sm text-muted">{t('auth.checkInboxBody', { email: sentTo })}</p>
          <Button variant="soft" onClick={() => setSentTo(null)}>
            {t('auth.useAnotherEmail')}
          </Button>
        </div>
      ) : (
        <div className="space-y-5 rounded-card bg-white p-5 shadow-sm ring-1 ring-black/5">
          <Button
            variant="soft"
            className="w-full"
            disabled={disabled}
            aria-busy={pending === 'google'}
            onClick={() => void onGoogle()}
          >
            <GoogleMark />
            {t('auth.continueWithGoogle')}
          </Button>

          <p className="flex items-center gap-3 text-xs uppercase tracking-wide text-muted">
            <span aria-hidden="true" className="h-px flex-1 bg-black/10" />
            {t('auth.orDivider')}
            <span aria-hidden="true" className="h-px flex-1 bg-black/10" />
          </p>

          <form onSubmit={(event) => void onEmail(event)} noValidate className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-sm font-medium">
                {t('auth.emailLabel')}
              </label>
              <input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                className="min-h-11 w-full rounded-xl bg-canvas px-4 ring-1 ring-field focus:ring-brand"
                aria-invalid={errors.email ? 'true' : 'false'}
                aria-describedby={errors.email ? 'email-error' : undefined}
                {...register('email')}
              />
              {errors.email?.message && (
                <p id="email-error" role="alert" className="text-sm text-red-700">
                  {t(errors.email.message)}
                </p>
              )}
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={disabled}
              aria-busy={pending === 'email'}
            >
              {pending === 'email' ? t('auth.sending') : t('auth.sendMagicLink')}
            </Button>
          </form>
        </div>
      )}

      {error && (
        <p role="alert" className="text-center text-sm text-red-700">
          {t(`errors.auth.${error}`)}
        </p>
      )}
    </div>
  )
}
