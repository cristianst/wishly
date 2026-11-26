import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nextProvider } from 'react-i18next'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { routes } from '@/app/router'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { ProductImporterContext } from '@/features/product-import/context'
import type { ProductImporter } from '@/features/product-import/repository'
import { ReservationContext, type ReservationServices } from '@/features/reservations/context'
import type { PublicWishlistRepository } from '@/features/public/repository'
import { PublicWishlistRepositoryContext } from '@/features/public/repositoryContext'
import type { WishlistRepository } from '@/features/wishlists/repository'
import { WishlistRepositoryContext } from '@/features/wishlists/repositoryContext'
import { createFakeWishlistRepository } from './fakeWishlistRepository'
import type { AuthClient } from '@/features/auth/types'
import i18n from '@/i18n'

export function renderRoutes(
  path: string,
  authClient: AuthClient | null,
  state?: { from?: string },
  repository: WishlistRepository = createFakeWishlistRepository(),
  publicRepository: PublicWishlistRepository | null = null,
  reservations: ReservationServices | null = null,
  importer: ProductImporter | null = null,
) {
  const { pathname, search } = new URL(path, 'http://localhost')
  const router = createMemoryRouter(routes, { initialEntries: [{ pathname, search, state }] })
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AuthProvider client={authClient}>
          <WishlistRepositoryContext.Provider value={repository}>
            <PublicWishlistRepositoryContext.Provider value={publicRepository}>
              <ReservationContext.Provider value={reservations}>
                <ProductImporterContext.Provider value={importer}>
                  <RouterProvider router={router} />
                </ProductImporterContext.Provider>
              </ReservationContext.Provider>
            </PublicWishlistRepositoryContext.Provider>
          </WishlistRepositoryContext.Provider>
        </AuthProvider>
      </QueryClientProvider>
    </I18nextProvider>,
  )
  return { router, ...utils }
}
