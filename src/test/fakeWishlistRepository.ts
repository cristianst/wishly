import { ApiError } from '@/lib/api'
import type { WishlistRepository } from '@/features/wishlists/repository'
import type {
  Gift,
  GiftInput,
  Wishlist,
  WishlistDetail,
  WishlistInput,
} from '@/features/wishlists/types'

export interface FakeWishlistRepository extends WishlistRepository {
  lists: Wishlist[]
  gifts: Gift[]
  /** Makes the next call to the named method reject with the given code. */
  failNext(method: keyof WishlistRepository, code: ApiError['code']): void
  /** Current share token per list id. */
  tokens: Record<string, string>
  /** Gift ids the owner view should show as reserved. */
  reservedIds: Set<string>
}

let counter = 0
let rotations = 0
const makeToken = (seed: string) => `${seed}-${++rotations}`.padEnd(64, 'x')
const nextId = (prefix: string) => `${prefix}-${++counter}`
const now = () => new Date().toISOString()

export function createFakeWishlistRepository(
  seed: { lists?: Wishlist[]; gifts?: Gift[] } = {},
): FakeWishlistRepository {
  const state = { lists: [...(seed.lists ?? [])], gifts: [...(seed.gifts ?? [])] }
  const failures = new Map<string, ApiError['code']>()
  const tokens: Record<string, string> = {}
  const reservedIds = new Set<string>()
  const tokenFor = (id: string) => (tokens[id] ??= makeToken(id))

  const guard = (method: string) => {
    const code = failures.get(method)
    if (code) {
      failures.delete(method)
      throw new ApiError(code)
    }
  }
  const toGift = (wishlistId: string, input: GiftInput, id = nextId('gift')): Gift => ({
    id,
    wishlist_id: wishlistId,
    title: input.title,
    description: input.description,
    product_url: input.productUrl,
    image_url: input.imageUrl,
    price: input.price,
    currency: input.currency,
    created_at: now(),
    updated_at: now(),
  })

  return {
    get lists() {
      return state.lists
    },
    get gifts() {
      return state.gifts
    },
    tokens,
    reservedIds,
    failNext: (method, code) => void failures.set(method, code),

    async listWishlists() {
      guard('listWishlists')
      return state.lists.map((list) => ({
        ...list,
        itemCount: state.gifts.filter((gift) => gift.wishlist_id === list.id).length,
      }))
    },
    async getWishlist(id): Promise<WishlistDetail | null> {
      guard('getWishlist')
      const list = state.lists.find((item) => item.id === id)
      if (!list) return null
      return {
        ...list,
        shareToken: tokenFor(id),
        gifts: state.gifts.filter((gift) => gift.wishlist_id === id),
      }
    },
    async createWishlist(_ownerId, input: WishlistInput) {
      guard('createWishlist')
      const list: Wishlist = { id: nextId('list'), ...input, created_at: now(), updated_at: now() }
      state.lists.push(list)
      return list
    },
    async updateWishlist(id, input) {
      guard('updateWishlist')
      const list = state.lists.find((item) => item.id === id)
      if (!list) throw new ApiError('NOT_FOUND')
      Object.assign(list, input, { updated_at: now() })
      return list
    },
    async deleteWishlist(id) {
      guard('deleteWishlist')
      if (!state.lists.some((item) => item.id === id)) throw new ApiError('NOT_FOUND')
      state.lists = state.lists.filter((item) => item.id !== id)
      state.gifts = state.gifts.filter((gift) => gift.wishlist_id !== id)
    },
    async getReservedItemIds() {
      guard('getReservedItemIds')
      return [...reservedIds]
    },
    async rotateShareToken(id) {
      guard('rotateShareToken')
      if (!state.lists.some((item) => item.id === id)) throw new ApiError('NOT_FOUND')
      tokens[id] = makeToken(id)
      return tokens[id]
    },
    async createGift(wishlistId, input) {
      guard('createGift')
      const gift = toGift(wishlistId, input)
      state.gifts.push(gift)
      return gift
    },
    async updateGift(id, input) {
      guard('updateGift')
      const index = state.gifts.findIndex((gift) => gift.id === id)
      const existing = state.gifts[index]
      if (!existing) throw new ApiError('NOT_FOUND')
      const updated = {
        ...toGift(existing.wishlist_id, input, id),
        created_at: existing.created_at,
      }
      state.gifts[index] = updated
      return updated
    },
    async deleteGift(id) {
      guard('deleteGift')
      if (!state.gifts.some((gift) => gift.id === id)) throw new ApiError('NOT_FOUND')
      state.gifts = state.gifts.filter((gift) => gift.id !== id)
    },
  }
}

export const sampleWishlist = (overrides: Partial<Wishlist> = {}): Wishlist => ({
  id: 'list-a',
  title: 'Birthday',
  description: 'Things I like',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
})

export const sampleGift = (overrides: Partial<Gift> = {}): Gift => ({
  id: 'gift-a',
  wishlist_id: 'list-a',
  title: 'Headphones',
  description: null,
  product_url: 'https://example.com/p',
  image_url: null,
  price: 99.9,
  currency: 'EUR',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
})
