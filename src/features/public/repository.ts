import { z } from 'zod'
import { ApiError } from '@/lib/api'
import { toFunctionApiError, type FunctionInvoker } from '@/lib/functions'
import { publicWishlistSchema, type PublicWishlist } from './types'

/** Guest-side read access, served by the public-wishlist Edge Function. */
export interface PublicWishlistRepository {
  getPublicWishlist(shareToken: string): Promise<PublicWishlist>
}

const responseSchema = z.object({ wishlist: publicWishlistSchema })

export function createSupabasePublicWishlistRepository(
  functions: FunctionInvoker,
): PublicWishlistRepository {
  return {
    async getPublicWishlist(shareToken) {
      // The token goes in the POST body so it never appears in gateway access logs.
      const { data, error } = await functions.invoke('public-wishlist', {
        body: { token: shareToken },
      })
      if (error) throw toFunctionApiError(error)

      const parsed = responseSchema.safeParse(data)
      if (!parsed.success) throw new ApiError('UNKNOWN')
      return parsed.data.wishlist
    },
  }
}
