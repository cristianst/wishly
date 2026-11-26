import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { I18nextProvider } from 'react-i18next'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { createSupabaseAuthClient } from '@/features/auth/supabaseAuthClient'
import type { AuthClient } from '@/features/auth/types'
import { ReservationContext, type ReservationServices } from '@/features/reservations/context'
import { createSupabaseReservationRepository } from '@/features/reservations/repository'
import { createSecretStore } from '@/features/reservations/secrets'
import { ProductImporterContext } from '@/features/product-import/context'
import { createSupabaseProductImporter } from '@/features/product-import/repository'
import type { ProductImporter } from '@/features/product-import/repository'
import { createSupabasePublicWishlistRepository } from '@/features/public/repository'
import type { PublicWishlistRepository } from '@/features/public/repository'
import { PublicWishlistRepositoryContext } from '@/features/public/repositoryContext'
import { createSupabaseWishlistRepository } from '@/features/wishlists/repository'
import type { WishlistRepository } from '@/features/wishlists/repository'
import { WishlistRepositoryContext } from '@/features/wishlists/repositoryContext'
import i18n from '@/i18n'
import { supabase } from '@/lib/supabase'

const defaultAuthClient: AuthClient | null = supabase ? createSupabaseAuthClient(supabase) : null

const defaultRepository: WishlistRepository | null = supabase
  ? createSupabaseWishlistRepository(supabase)
  : null

const defaultPublicRepository: PublicWishlistRepository | null = supabase
  ? createSupabasePublicWishlistRepository(supabase.functions)
  : null

const defaultReservations: ReservationServices | null = supabase
  ? {
      repository: createSupabaseReservationRepository(supabase.functions),
      secrets: createSecretStore(),
    }
  : null

const defaultImporter: ProductImporter | null = supabase
  ? createSupabaseProductImporter(supabase.functions)
  : null

export function Providers({
  children,
  authClient = defaultAuthClient,
  repository = defaultRepository,
  publicRepository = defaultPublicRepository,
  reservations = defaultReservations,
  importer = defaultImporter,
}: {
  children: ReactNode
  authClient?: AuthClient | null
  repository?: WishlistRepository | null
  publicRepository?: PublicWishlistRepository | null
  reservations?: ReservationServices | null
  importer?: ProductImporter | null
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } }),
  )

  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider client={authClient}>
          <WishlistRepositoryContext.Provider value={repository}>
            <PublicWishlistRepositoryContext.Provider value={publicRepository}>
              <ReservationContext.Provider value={reservations}>
                <ProductImporterContext.Provider value={importer}>
                  {children}
                </ProductImporterContext.Provider>
              </ReservationContext.Provider>
            </PublicWishlistRepositoryContext.Provider>
          </WishlistRepositoryContext.Provider>
        </AuthProvider>
      </QueryClientProvider>
    </I18nextProvider>
  )
}
