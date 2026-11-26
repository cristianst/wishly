import { ApiError } from './api'

/**
 * How often an open page quietly re-checks for changes made by other people.
 * React Query pauses interval refetching while the tab is hidden, and refetches immediately
 * when the tab regains focus, so this only costs requests while someone is looking.
 */
export const LIVE_REFRESH_MS = 30_000

export const isNotFoundError = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'NOT_FOUND'
