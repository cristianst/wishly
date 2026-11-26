import { createContext, useContext } from 'react'
import type { WishlistRepository } from './repository'

export const WishlistRepositoryContext = createContext<WishlistRepository | null>(null)

export function useWishlistRepository(): WishlistRepository {
  const repository = useContext(WishlistRepositoryContext)
  if (!repository) throw new Error('useWishlistRepository must be used inside <Providers>')
  return repository
}
