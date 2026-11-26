import { useState } from 'react'

/** Shows the merchant-hosted image by URL (we never copy it); falls back to an emoji. */
export function GiftThumbnail({ imageUrl }: { imageUrl: string | null }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const showImage = imageUrl !== null && imageUrl !== failedUrl

  return (
    <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-brand-soft text-3xl">
      {showImage ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-full object-cover"
          onError={() => setFailedUrl(imageUrl)}
        />
      ) : (
        <span aria-hidden="true">🎁</span>
      )}
    </div>
  )
}
