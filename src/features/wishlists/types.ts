import { z } from 'zod'

export const wishlistSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type Wishlist = z.infer<typeof wishlistSchema>

export const wishlistSummarySchema = wishlistSchema.extend({
  wishlist_items: z.array(z.object({ count: z.number() })),
})
export type WishlistSummary = Wishlist & { itemCount: number }

export const giftSchema = z.object({
  id: z.string(),
  wishlist_id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  product_url: z.string().nullable(),
  image_url: z.string().nullable(),
  price: z.number().nullable(),
  currency: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})
export type Gift = z.infer<typeof giftSchema>

export const wishlistDetailSchema = wishlistSchema.extend({
  share_token: z.string().min(32),
  wishlist_items: z.array(giftSchema),
})
export interface WishlistDetail extends Wishlist {
  /** Capability that grants read access to the list; shown to the owner only. */
  shareToken: string
  gifts: Gift[]
}

export interface WishlistInput {
  title: string
  description: string | null
}

export interface GiftInput {
  title: string
  description: string | null
  productUrl: string | null
  imageUrl: string | null
  price: number | null
  currency: string
}
