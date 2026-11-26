import { createContext, useContext } from 'react'
import type { ProductImporter } from './repository'

export const ProductImporterContext = createContext<ProductImporter | null>(null)

/** Null when importing is unavailable (e.g. no backend configured): the form is manual-only. */
export function useProductImporter(): ProductImporter | null {
  return useContext(ProductImporterContext)
}
