import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Shows the product image straight from the shop's own server (we store only the link, never a copy)
 * next to the title. Shops may block loading their images on other sites, so failure is explained.
 */
export function ProductPreview({ imageUrl, title }: { imageUrl: string; title: string }) {
  const { t } = useTranslation()
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const failed = failedUrl === imageUrl

  return (
    <figure
      aria-label={t('gift.previewLabel')}
      className="flex items-center gap-3 rounded-xl bg-brand-soft p-3"
    >
      {failed ? (
        <p role="status" className="text-sm text-muted">
          {t('gift.imagePreviewFailed')}
        </p>
      ) : (
        <img
          src={imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="size-20 shrink-0 rounded-lg bg-white object-cover"
          onError={() => setFailedUrl(imageUrl)}
        />
      )}
      {title && (
        <figcaption className="wrap-anywhere min-w-0 text-sm font-medium">{title}</figcaption>
      )}
    </figure>
  )
}
