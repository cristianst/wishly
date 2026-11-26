import { useTranslation } from 'react-i18next'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './useAuth'

export function ProtectedRoute() {
  const { t } = useTranslation()
  const { status, session } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <p role="status" className="pt-16 text-center text-muted">
        {t('common.loading')}
      </p>
    )
  }
  if (!session) {
    return (
      <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />
    )
  }
  return <Outlet />
}
