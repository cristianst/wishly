import { createContext, useContext } from 'react'
import type { ReservationRepository } from './repository'
import type { SecretStore } from './secrets'

export interface ReservationServices {
  repository: ReservationRepository
  secrets: SecretStore
}

export const ReservationContext = createContext<ReservationServices | null>(null)

/** Null when reservations are unavailable (e.g. no backend configured): the page is read-only. */
export function useReservationServices(): ReservationServices | null {
  return useContext(ReservationContext)
}
