import { LIVE_REFRESH_MS } from '@/lib/polling'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/features/auth/useAuth'
import type { GiftInput, WishlistInput } from './types'
import { useWishlistRepository } from './repositoryContext'

export const myWishlistsKey = (userId: string | undefined) => ['my-wishlists', userId] as const
export const wishlistKey = (id: string) => ['wishlist', id] as const

function useUserId(): string | undefined {
  return useAuth().session?.user.id
}

export function useMyWishlists() {
  const repository = useWishlistRepository()
  const userId = useUserId()
  return useQuery({
    queryKey: myWishlistsKey(userId),
    queryFn: () => repository.listWishlists(),
    enabled: userId !== undefined,
  })
}

export function useWishlist(id: string) {
  const repository = useWishlistRepository()
  return useQuery({
    queryKey: wishlistKey(id),
    queryFn: () => repository.getWishlist(id),
    retry: false,
  })
}

export function useCreateWishlist() {
  const repository = useWishlistRepository()
  const userId = useUserId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: WishlistInput) => {
      if (!userId) throw new Error('Not signed in')
      return repository.createWishlist(userId, input)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: myWishlistsKey(userId) }),
  })
}

export function useUpdateWishlist(id: string) {
  const repository = useWishlistRepository()
  const userId = useUserId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: WishlistInput) => repository.updateWishlist(id, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: wishlistKey(id) }),
        queryClient.invalidateQueries({ queryKey: myWishlistsKey(userId) }),
      ])
    },
  })
}

export function useDeleteWishlist(id: string) {
  const repository = useWishlistRepository()
  const userId = useUserId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => repository.deleteWishlist(id),
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: wishlistKey(id) })
      await queryClient.invalidateQueries({ queryKey: myWishlistsKey(userId) })
    },
  })
}

function useInvalidateAfterGiftChange(wishlistId: string) {
  const userId = useUserId()
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: wishlistKey(wishlistId) }),
      queryClient.invalidateQueries({ queryKey: myWishlistsKey(userId) }),
    ])
}

export function useCreateGift(wishlistId: string) {
  const repository = useWishlistRepository()
  const invalidate = useInvalidateAfterGiftChange(wishlistId)
  return useMutation({
    mutationFn: (input: GiftInput) => repository.createGift(wishlistId, input),
    onSuccess: invalidate,
  })
}

export function useUpdateGift(wishlistId: string) {
  const repository = useWishlistRepository()
  const invalidate = useInvalidateAfterGiftChange(wishlistId)
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: GiftInput }) =>
      repository.updateGift(id, input),
    onSuccess: invalidate,
  })
}

export function useDeleteGift(wishlistId: string) {
  const repository = useWishlistRepository()
  const invalidate = useInvalidateAfterGiftChange(wishlistId)
  return useMutation({
    mutationFn: (id: string) => repository.deleteGift(id),
    onSuccess: invalidate,
  })
}

export function useRotateShareToken(id: string) {
  const repository = useWishlistRepository()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => repository.rotateShareToken(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: wishlistKey(id) }),
  })
}

export function useReservedItemIds(wishlistId: string) {
  const repository = useWishlistRepository()
  return useQuery({
    queryKey: ['wishlist-reservations', wishlistId],
    queryFn: () => repository.getReservedItemIds(wishlistId),
    // Only the reservation badges refresh; the list and gift forms are never touched.
    refetchInterval: LIVE_REFRESH_MS,
  })
}
