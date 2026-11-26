import type { ProductImporter } from '@/features/product-import/repository'
import type { ProductMetadata } from '@/features/product-import/types'

export interface FakeProductImporter extends ProductImporter {
  calls: string[]
  /** Holds the next import open until `release` is called, to test pending and stale states. */
  holdNext(): { release(result: ProductMetadata | Error): void }
}

export function createFakeProductImporter(
  respond: (url: string) => ProductMetadata | Error,
): FakeProductImporter {
  const calls: string[] = []
  let hold: { promise: Promise<ProductMetadata | Error> } | null = null

  return {
    calls,
    holdNext() {
      let release!: (value: ProductMetadata | Error) => void
      const promise = new Promise<ProductMetadata | Error>((resolve) => (release = resolve))
      hold = { promise }
      return { release }
    },
    async importFromUrl(url) {
      calls.push(url)
      const outcome = hold ? await hold.promise : respond(url)
      hold = null
      if (outcome instanceof Error) throw outcome
      return outcome
    },
  }
}

export const importedShirt: ProductMetadata = {
  sourceUrl: 'https://www.otto.de/p/shirt-C1/?variationId=9',
  extractionStatus: 'success',
  title: 'adidas Real Madrid Heimtrikot',
  description: 'Schmale Passform',
  imageUrl: 'https://img.example.com/shirt.jpg',
  price: 89.9,
  currency: 'EUR',
}
