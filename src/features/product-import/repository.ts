import { FunctionsHttpError } from '@supabase/supabase-js'
import { ApiError } from '@/lib/api'
import { toFunctionApiError, type FunctionInvoker } from '@/lib/functions'
import { productMetadataSchema, type ProductMetadata } from './types'

/** Best-effort details for a product link. Never blocks manual entry. */
export interface ProductImporter {
  importFromUrl(url: string): Promise<ProductMetadata>
}

export function createSupabaseProductImporter(functions: FunctionInvoker): ProductImporter {
  return {
    async importFromUrl(url) {
      const { data, error } = await functions.invoke('product-metadata', { body: { url } })
      if (error) {
        if (error instanceof FunctionsHttpError) {
          const context: unknown = error.context
          if (context instanceof Response && context.status === 400)
            throw new ApiError('INVALID_URL')
        }
        throw toFunctionApiError(error)
      }
      const parsed = productMetadataSchema.safeParse(data)
      if (!parsed.success) throw new ApiError('UNKNOWN')
      const metadata: ProductMetadata = parsed.data
      return metadata
    },
  }
}
