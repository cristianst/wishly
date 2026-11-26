import { Gift } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/features/auth/useAuth'
import { LanguageSelector } from './LanguageSelector'

export function AppShell() {
  const { t } = useTranslation()
  const { status, session, signOut } = useAuth()
  const { pathname } = useLocation()
  const [announcement, setAnnouncement] = useState('')
  const isFirstRender = useRef(true)

  // A single-page app does not reload, so assistive technology is told about navigation explicitly:
  // focus moves to the main content (keyboard users start at the top of the new page) and the new
  // page title is announced. Skipped on first load, which the browser already announces.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    document.getElementById('main')?.focus({ preventScroll: true })
    window.scrollTo(0, 0)
    // Pages set their title in an effect, so read it after they have had a chance to run.
    const timer = setTimeout(() => setAnnouncement(document.title), 150)
    return () => clearTimeout(timer)
  }, [pathname])

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-10 focus:rounded-full focus:bg-white focus:px-4 focus:py-2"
      >
        {t('common.skipToContent')}
      </a>
      <header className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <Link to="/" className="inline-flex min-h-11 items-center gap-2 text-lg font-semibold">
          <Gift aria-hidden="true" className="size-5 text-brand" />
          {t('common.appName')}
        </Link>
        <nav className="flex min-w-0 flex-wrap items-center justify-end gap-1 sm:gap-2">
          {status === 'ready' &&
            (session ? (
              <>
                <Button asChild variant="ghost" className="whitespace-nowrap px-3">
                  <Link to="/dashboard">{t('nav.dashboard')}</Link>
                </Button>
                <Button
                  variant="ghost"
                  className="whitespace-nowrap px-3"
                  onClick={() => void signOut()}
                >
                  {t('auth.signOut')}
                </Button>
              </>
            ) : (
              <Button asChild variant="ghost" className="whitespace-nowrap px-3">
                <Link to="/login">{t('auth.signIn')}</Link>
              </Button>
            ))}
          <LanguageSelector />
        </nav>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16 outline-none"
      >
        <Outlet />
      </main>
      <footer className="mx-auto w-full max-w-5xl px-4 pb-8 text-sm text-muted">
        <Link to="/privacy" className="inline-flex min-h-11 items-center underline">
          {t('privacy.link')}
        </Link>
      </footer>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </div>
  )
}
