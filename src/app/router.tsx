import { createBrowserRouter, type RouteObject } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { InitialLoading } from '@/components/layout/InitialLoading'
import { NotFoundPage } from '@/features/errors/NotFoundPage'
import { LandingPage } from '@/features/landing/LandingPage'

/**
 * Pages other than the landing page are loaded on demand, so a guest opening a shared link
 * never downloads the creator's editor, forms or import code (and vice versa).
 */
export const routes: RouteObject[] = [
  {
    element: <AppShell />,
    HydrateFallback: InitialLoading,
    children: [
      { index: true, element: <LandingPage /> },
      {
        path: 'privacy',
        lazy: async () => ({
          Component: (await import('@/features/legal/PrivacyPage')).PrivacyPage,
        }),
      },
      {
        path: 'login',
        lazy: async () => ({ Component: (await import('@/features/auth/LoginPage')).LoginPage }),
      },
      {
        path: 'auth/callback',
        lazy: async () => ({
          Component: (await import('@/features/auth/AuthCallbackPage')).AuthCallbackPage,
        }),
      },
      {
        path: 'l/:shareToken',
        lazy: async () => ({
          Component: (await import('@/features/public/PublicWishlistPage')).PublicWishlistPage,
        }),
      },
      {
        lazy: async () => ({
          Component: (await import('@/features/auth/ProtectedRoute')).ProtectedRoute,
        }),
        children: [
          {
            path: 'dashboard',
            lazy: async () => ({
              Component: (await import('@/features/wishlists/DashboardPage')).DashboardPage,
            }),
          },
          {
            path: 'wishlists/new',
            lazy: async () => ({
              Component: (await import('@/features/wishlists/NewWishlistPage')).NewWishlistPage,
            }),
          },
          {
            path: 'wishlists/:id/edit',
            lazy: async () => ({
              Component: (await import('@/features/wishlists/EditWishlistPage')).EditWishlistPage,
            }),
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]

export const createRouter = () => createBrowserRouter(routes)
