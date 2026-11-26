import { Copy, ExternalLink, RefreshCw } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ApiError } from '@/lib/api'
import { useRotateShareToken } from './hooks'

type CopyState = 'idle' | 'copied' | 'failed'

export function ShareSection({
  wishlistId,
  shareToken,
}: {
  wishlistId: string
  shareToken: string
}) {
  const { t } = useTranslation()
  const rotate = useRotateShareToken(wishlistId)
  const inputRef = useRef<HTMLInputElement>(null)
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const [confirming, setConfirming] = useState(false)
  const [rotated, setRotated] = useState(false)

  const url = `${window.location.origin}/l/${shareToken}`

  const copy = async () => {
    setRotated(false)
    try {
      await navigator.clipboard.writeText(url)
      setCopyState('copied')
    } catch {
      inputRef.current?.select()
      setCopyState('failed')
    }
  }

  return (
    <section aria-labelledby="share-heading" className="max-w-lg space-y-3">
      <h2 id="share-heading" className="text-xl font-semibold">
        {t('share.heading')}
      </h2>
      <p className="text-sm text-muted">{t('share.description')}</p>

      <label className="sr-only" htmlFor="share-link">
        {t('share.linkLabel')}
      </label>
      <input
        id="share-link"
        ref={inputRef}
        readOnly
        value={url}
        onFocus={(event) => event.currentTarget.select()}
        className="min-h-11 w-full rounded-xl bg-white px-4 text-sm ring-1 ring-field"
      />

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void copy()}>
          <Copy aria-hidden="true" className="size-4" />
          {t('share.copy')}
        </Button>
        <Button asChild variant="soft">
          <a href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden="true" className="size-4" />
            {t('share.preview')}
          </a>
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            rotate.reset()
            setConfirming(true)
          }}
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          {t('share.regenerate')}
        </Button>
      </div>

      <div role="status" aria-live="polite" className="min-h-5 text-sm text-brand">
        {copyState === 'copied' && t('share.copied')}
        {copyState === 'failed' && t('share.copyFailed')}
        {rotated && t('share.regenerated')}
      </div>
      {rotate.error && (
        <p role="alert" className="text-sm text-red-700">
          {t(`errors.api.${rotate.error instanceof ApiError ? rotate.error.code : 'UNKNOWN'}`)}
        </p>
      )}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('share.regenerateTitle')}
        description={t('share.regenerateDescription')}
        confirmLabel={t('share.regenerateConfirm')}
        pending={rotate.isPending}
        onConfirm={() =>
          rotate.mutate(undefined, {
            onSuccess: () => {
              setCopyState('idle')
              setRotated(true)
            },
            onSettled: () => setConfirming(false),
          })
        }
      />
    </section>
  )
}
