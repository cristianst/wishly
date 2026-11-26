/** Stable error codes; the UI maps them to localized messages (errors.api.<code>). */
export type ApiErrorCode =
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'RESERVATION_CONFLICT'
  | 'NOT_RESERVATION_OWNER'
  | 'INVALID_URL'
  | 'NETWORK'
  | 'UNKNOWN'

export class ApiError extends Error {
  readonly code: ApiErrorCode

  constructor(code: ApiErrorCode) {
    super(code)
    this.name = 'ApiError'
    this.code = code
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error
  const candidate = (error ?? {}) as { code?: unknown; message?: unknown }
  if (candidate.code === '42501' || candidate.code === 'PGRST301')
    return new ApiError('UNAUTHORIZED')
  if (candidate.code === 'PGRST116' || candidate.code === 'P0002') return new ApiError('NOT_FOUND')
  const message = typeof candidate.message === 'string' ? candidate.message : ''
  if (/failed to fetch|networkerror|load failed/i.test(message)) return new ApiError('NETWORK')
  return new ApiError('UNKNOWN')
}
