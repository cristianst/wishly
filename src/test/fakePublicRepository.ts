import { ApiError } from '@/lib/api'
import type { PublicWishlistRepository } from '@/features/public/repository'
import type { PublicGift, PublicWishlist } from '@/features/public/types'

export const samplePublicGift = (overrides: Partial<PublicGift> = {}): PublicGift => ({
  id: 'g1',
  title: 'Lamp',
  description: 'Warm light',
  productUrl: 'https://example.com/lamp',
  imageUrl: null,
  price: 49,
  currency: 'EUR',
  reserved: false,
  ...overrides,
})

export function createFakePublicRepository(
  lists: Record<string, PublicWishlist>,
  failure?: ApiError['code'],
): PublicWishlistRepository & { requests: string[] } {
  const requests: string[] = []
  return {
    requests,
    async getPublicWishlist(token) {
      requests.push(token)
      if (failure) throw new ApiError(failure)
      const list = lists[token]
      if (!list) throw new ApiError('NOT_FOUND')
      return list
    },
  }
}
