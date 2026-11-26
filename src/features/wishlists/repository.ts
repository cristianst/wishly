import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { ApiError, toApiError } from '@/lib/api'
import {
  giftSchema,
  wishlistDetailSchema,
  wishlistSchema,
  wishlistSummarySchema,
  type Gift,
  type GiftInput,
  type Wishlist,
  type WishlistDetail,
  type WishlistInput,
  type WishlistSummary,
} from './types'

/** Owner-side data access. Authorization is enforced by RLS in the database. */
export interface WishlistRepository {
  listWishlists(): Promise<WishlistSummary[]>
  getWishlist(id: string): Promise<WishlistDetail | null>
  createWishlist(ownerId: string, input: WishlistInput): Promise<Wishlist>
  updateWishlist(id: string, input: WishlistInput): Promise<Wishlist>
  deleteWishlist(id: string): Promise<void>
  /** Ids of this list's reserved gifts. Never reveals who reserved them. */
  getReservedItemIds(wishlistId: string): Promise<string[]>
  /** Replaces the share link; the previous link stops working immediately. */
  rotateShareToken(id: string): Promise<string>
  createGift(wishlistId: string, input: GiftInput): Promise<Gift>
  updateGift(id: string, input: GiftInput): Promise<Gift>
  deleteGift(id: string): Promise<void>
}

const giftColumns = (input: GiftInput) => ({
  title: input.title,
  description: input.description,
  product_url: input.productUrl,
  image_url: input.imageUrl,
  price: input.price,
  currency: input.currency,
})

/** Runs a query, converting any failure or malformed response into an ApiError. */
async function run<T>(
  operation: () => PromiseLike<{ data: unknown; error: unknown }>,
  parse: (data: unknown) => T,
): Promise<T> {
  let result: { data: unknown; error: unknown }
  try {
    result = await operation()
  } catch (error) {
    throw toApiError(error)
  }
  if (result.error) throw toApiError(result.error)
  try {
    return parse(result.data)
  } catch {
    throw new ApiError('UNKNOWN')
  }
}

export function createSupabaseWishlistRepository(supabase: SupabaseClient): WishlistRepository {
  return {
    listWishlists: () =>
      run(
        () =>
          supabase
            .from('wishlists')
            .select('id, title, description, created_at, updated_at, wishlist_items(count)')
            .order('created_at', { ascending: false }),
        (data) =>
          wishlistSummarySchema
            .array()
            .parse(data)
            .map(({ wishlist_items, ...list }) => ({
              ...list,
              itemCount: wishlist_items[0]?.count ?? 0,
            })),
      ),

    getWishlist: (id) =>
      run(
        () =>
          supabase
            .from('wishlists')
            .select(
              'id, title, description, share_token, created_at, updated_at, wishlist_items(id, wishlist_id, title, description, product_url, image_url, price, currency, created_at, updated_at)',
            )
            .eq('id', id)
            .order('created_at', { referencedTable: 'wishlist_items', ascending: true })
            .maybeSingle(),
        (data) => {
          if (data === null) return null
          const { wishlist_items, share_token, ...list } = wishlistDetailSchema.parse(data)
          return { ...list, shareToken: share_token, gifts: wishlist_items }
        },
      ),

    createWishlist: (ownerId, input) =>
      run(
        () =>
          supabase
            .from('wishlists')
            .insert({ owner_id: ownerId, title: input.title, description: input.description })
            .select('id, title, description, created_at, updated_at')
            .single(),
        (data) => wishlistSchema.parse(data),
      ),

    updateWishlist: (id, input) =>
      run(
        () =>
          supabase
            .from('wishlists')
            .update({ title: input.title, description: input.description })
            .eq('id', id)
            .select('id, title, description, created_at, updated_at')
            .single(),
        (data) => wishlistSchema.parse(data),
      ),

    deleteWishlist: (id) =>
      run(
        () => supabase.from('wishlists').delete().eq('id', id).select('id'),
        (data) => {
          // RLS hides other owners' rows, which then match nothing instead of erroring.
          if (!Array.isArray(data) || data.length === 0) throw new ApiError('NOT_FOUND')
        },
      ),

    getReservedItemIds: (wishlistId) =>
      run(
        () => supabase.rpc('get_reserved_item_ids', { p_wishlist_id: wishlistId }),
        (data) => z.array(z.string()).parse(data),
      ),

    rotateShareToken: (id) =>
      run(
        () => supabase.rpc('rotate_share_token', { p_wishlist_id: id }),
        (data) => z.string().min(32).parse(data),
      ),

    createGift: (wishlistId, input) =>
      run(
        () =>
          supabase
            .from('wishlist_items')
            .insert({ wishlist_id: wishlistId, ...giftColumns(input) })
            .select()
            .single(),
        (data) => giftSchema.parse(data),
      ),

    updateGift: (id, input) =>
      run(
        () =>
          supabase.from('wishlist_items').update(giftColumns(input)).eq('id', id).select().single(),
        (data) => giftSchema.parse(data),
      ),

    deleteGift: (id) =>
      run(
        () => supabase.from('wishlist_items').delete().eq('id', id).select('id'),
        (data) => {
          if (!Array.isArray(data) || data.length === 0) throw new ApiError('NOT_FOUND')
        },
      ),
  }
}
