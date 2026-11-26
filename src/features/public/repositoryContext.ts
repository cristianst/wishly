import { createContext, useContext } from 'react'
import type { PublicWishlistRepository } from './repository'

export const PublicWishlistRepositoryContext = createContext<PublicWishlistRepository | null>(null)

export function usePublicWishlistRepository(): PublicWishlistRepository | null {
  return useContext(PublicWishlistRepositoryContext)
}
