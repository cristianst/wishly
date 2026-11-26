import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js'
import { ApiError } from './api'

/** The part of `supabase.functions` the repositories need; keeps them testable without a client. */
export interface FunctionInvoker {
  invoke(
    name: string,
    options: { body: Record<string, unknown>; method?: 'POST' | 'DELETE' },
  ): Promise<{ data: unknown; error: unknown }>
}

/** Maps an Edge Function failure to a stable error code (status codes are the contract). */
export function toFunctionApiError(error: unknown): ApiError {
  if (error instanceof FunctionsHttpError) {
    const context: unknown = error.context
    switch (context instanceof Response ? context.status : 0) {
      case 401:
        return new ApiError('UNAUTHORIZED')
      case 404:
        return new ApiError('NOT_FOUND')
      case 429:
        return new ApiError('RATE_LIMITED')
      case 409:
        return new ApiError('RESERVATION_CONFLICT')
      case 403:
        return new ApiError('NOT_RESERVATION_OWNER')
      default:
        return new ApiError('UNKNOWN')
    }
  }
  if (error instanceof FunctionsFetchError) return new ApiError('NETWORK')
  return new ApiError('UNKNOWN')
}
