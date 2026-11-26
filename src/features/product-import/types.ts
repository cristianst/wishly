import { z } from 'zod'
import { isHttpUrl } from '@/lib/validation'

/** What the product-metadata function returns. Every field is re-validated here (untrusted boundary). */
export const productMetadataSchema = z.object({
  sourceUrl: z.string(),
  extractionStatus: z.enum(['success', 'partial', 'failed']),
  title: z
    .string()
    .optional()
    .transform((value) => value?.trim().slice(0, 150) || undefined),
  description: z
    .string()
    .optional()
    .transform((value) => value?.trim().slice(0, 2000) || undefined),
  imageUrl: z
    .string()
    .optional()
    .transform((value) => (value !== undefined && isHttpUrl(value) ? value : undefined)),
  price: z.number().min(0).max(9_999_999_999).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  failureReason: z.enum(['BLOCKED', 'NOT_HTML', 'UNREACHABLE', 'NO_DATA']).optional(),
})

/** Fields the page did not provide are simply absent. */
export interface ProductMetadata {
  sourceUrl: string
  extractionStatus: 'success' | 'partial' | 'failed'
  title?: string
  description?: string
  imageUrl?: string
  price?: number
  currency?: string
  failureReason?: 'BLOCKED' | 'NOT_HTML' | 'UNREACHABLE' | 'NO_DATA'
}
