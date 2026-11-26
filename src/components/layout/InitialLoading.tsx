import { LoadingSkeleton } from '@/components/ui/states'

/** Shown while the first (lazy) page of a direct visit is still downloading. */
export function InitialLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-8">
      <LoadingSkeleton />
    </div>
  )
}
