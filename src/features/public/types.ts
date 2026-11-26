import { z } from 'zod'
import { isHttpUrl } from '@/lib/validation'

/** Defense in depth: even though the database constrains URLs, never render a non-http(s) link. */
const safeUrl = z
  .string()
  .nullable()
  .transform((value) => (value !== null && isHttpUrl(value) ? value : null))

export const publicGiftSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  productUrl: safeUrl,
  imageUrl: safeUrl,
  price: z.number().nullable(),
  currency: z.string(),
  reserved: z.boolean(),
})
export type PublicGift = z.infer<typeof publicGiftSchema>

export const publicWishlistSchema = z.object({
  title: z.string(),
  description: z.string().nullable(),
  items: z.array(publicGiftSchema),
})
export type PublicWishlist = z.infer<typeof publicWishlistSchema>
