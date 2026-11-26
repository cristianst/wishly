import { z } from 'zod'

/** Messages are translation keys; components translate them when rendering. */
export const emailSchema = z
  .string()
  .trim()
  .min(1, 'validation.emailRequired')
  .pipe(z.email('validation.emailInvalid'))

export const loginFormSchema = z.object({ email: emailSchema })
export type LoginFormValues = z.infer<typeof loginFormSchema>

// ---------------------------------------------------------------- wishlists
export const wishlistFormSchema = z.object({
  title: z.string().trim().min(1, 'validation.titleRequired').max(100, 'validation.titleTooLong'),
  description: z.string().trim().max(1000, 'validation.descriptionTooLong'),
})
export type WishlistFormValues = z.infer<typeof wishlistFormSchema>

/** Only http(s) links are accepted; anything else (javascript:, data:, …) is rejected. */
export function isHttpUrl(value: string): boolean {
  if (value.length > 2048) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** Accepts `12`, `12.5`, `12,50`; returns null for anything else (no thousands separators). */
export function parsePrice(value: string): number | null {
  const text = value.trim()
  if (!/^\d{1,10}([.,]\d{1,2})?$/.test(text)) return null
  return Number(text.replace(',', '.'))
}

export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'PLN', 'SEK', 'DKK', 'CAD'] as const

export const giftFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'validation.titleRequired')
    .max(150, 'validation.giftTitleTooLong'),
  description: z.string().trim().max(2000, 'validation.giftDescriptionTooLong'),
  productUrl: z
    .string()
    .trim()
    .refine((v) => v === '' || isHttpUrl(v), 'validation.urlInvalid'),
  imageUrl: z
    .string()
    .trim()
    .refine((v) => v === '' || isHttpUrl(v), 'validation.urlInvalid'),
  price: z
    .string()
    .trim()
    .refine((v) => v === '' || parsePrice(v) !== null, 'validation.priceInvalid'),
  currency: z.string().regex(/^[A-Z]{3}$/, 'validation.currencyInvalid'),
})
export type GiftFormValues = z.infer<typeof giftFormSchema>
