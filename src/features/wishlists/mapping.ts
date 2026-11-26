import { parsePrice, type GiftFormValues, type WishlistFormValues } from '@/lib/validation'
import type { Gift, GiftInput, WishlistInput } from './types'

const blankToNull = (value: string): string | null => (value === '' ? null : value)

export function toWishlistInput(values: WishlistFormValues): WishlistInput {
  return { title: values.title, description: blankToNull(values.description) }
}

export function toGiftInput(values: GiftFormValues): GiftInput {
  return {
    title: values.title,
    description: blankToNull(values.description),
    productUrl: blankToNull(values.productUrl),
    imageUrl: blankToNull(values.imageUrl),
    price: values.price === '' ? null : parsePrice(values.price),
    currency: values.currency,
  }
}

export function giftToFormValues(gift: Gift): GiftFormValues {
  return {
    title: gift.title,
    description: gift.description ?? '',
    productUrl: gift.product_url ?? '',
    imageUrl: gift.image_url ?? '',
    price: gift.price === null ? '' : String(gift.price),
    currency: gift.currency,
  }
}

export const EMPTY_GIFT_VALUES: GiftFormValues = {
  title: '',
  description: '',
  productUrl: '',
  imageUrl: '',
  price: '',
  currency: 'EUR',
}
