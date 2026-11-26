import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { SelectField, TextAreaField, TextField } from '@/components/ui/text-field'
import { useProductImporter } from '@/features/product-import/context'
import { ProductPreview } from '@/features/product-import/ProductPreview'
import type { ProductMetadata } from '@/features/product-import/types'
import { EMPTY_GIFT_VALUES } from '@/features/wishlists/mapping'
import { ApiError, type ApiErrorCode } from '@/lib/api'
import { CURRENCIES, giftFormSchema, isHttpUrl, type GiftFormValues } from '@/lib/validation'

type ImportState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | {
      kind: 'done'
      status: ProductMetadata['extractionStatus']
      reason?: ProductMetadata['failureReason']
    }
  | { kind: 'error'; code: ApiErrorCode }

export function GiftForm({
  initialValues = EMPTY_GIFT_VALUES,
  submitLabel,
  pending,
  onSubmit,
  onCancel,
}: {
  initialValues?: GiftFormValues
  submitLabel: string
  pending: boolean
  onSubmit: (values: GiftFormValues) => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const importer = useProductImporter()
  const {
    register,
    handleSubmit,
    control,
    setValue,
    getValues,
    setError,
    clearErrors,
    formState: { errors },
  } = useForm<GiftFormValues>({
    resolver: zodResolver(giftFormSchema),
    defaultValues: initialValues,
  })
  const [importState, setImportState] = useState<ImportState>({ kind: 'idle' })
  const latestRequest = useRef(0)

  const productUrl = (useWatch({ control, name: 'productUrl' }) ?? '').trim()
  const imageUrl = (useWatch({ control, name: 'imageUrl' }) ?? '').trim()
  const title = (useWatch({ control, name: 'title' }) ?? '').trim()
  // Keep any currency already stored on the gift, or returned by an import, selectable.
  const [importedCurrency, setImportedCurrency] = useState<{ code: string } | null>(null)
  const currencies = Array.from(
    new Set<string>([
      ...CURRENCIES,
      initialValues.currency,
      ...(importedCurrency ? [importedCurrency.code] : []),
    ]),
  )

  // The <select> must already contain an imported currency before it can be chosen.
  useEffect(() => {
    if (importedCurrency) setValue('currency', importedCurrency.code, { shouldDirty: true })
  }, [importedCurrency, setValue])

  const runImport = async () => {
    if (!importer) return
    const url = getValues('productUrl').trim()
    if (!isHttpUrl(url)) {
      setError('productUrl', { type: 'validate', message: 'validation.urlInvalid' })
      return
    }
    clearErrors('productUrl')

    const requestId = ++latestRequest.current
    setImportState({ kind: 'loading' })
    try {
      const result = await importer.importFromUrl(url)
      // The visitor changed the link (or started over) while we were waiting: drop the answer.
      if (requestId !== latestRequest.current || getValues('productUrl').trim() !== url) {
        setImportState({ kind: 'idle' })
        return
      }
      // Fill only what the page actually provided, so nothing is invented and nothing else is touched.
      const apply = { shouldDirty: true, shouldValidate: true } as const
      if (result.title) setValue('title', result.title, apply)
      if (result.description) setValue('description', result.description, apply)
      if (result.imageUrl) setValue('imageUrl', result.imageUrl, apply)
      if (result.price !== undefined) {
        setValue('price', result.price.toFixed(2), apply)
        if (result.currency) setImportedCurrency({ code: result.currency })
      }
      setImportState({
        kind: 'done',
        status: result.extractionStatus,
        reason: result.failureReason,
      })
    } catch (error) {
      if (requestId !== latestRequest.current) return
      setImportState({ kind: 'error', code: error instanceof ApiError ? error.code : 'UNKNOWN' })
    }
  }

  const importing = importState.kind === 'loading'

  return (
    <form
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
      noValidate
      className="space-y-4 rounded-card bg-white p-5 shadow-sm ring-1 ring-black/5"
    >
      <TextField
        label={t('gift.productUrlLabel')}
        type="url"
        inputMode="url"
        autoComplete="off"
        hint={importer ? t('gift.importHint') : undefined}
        error={errors.productUrl?.message}
        {...register('productUrl')}
      />

      {importer && (
        <div className="space-y-2">
          <Button
            type="button"
            variant="soft"
            disabled={importing || productUrl === ''}
            aria-busy={importing}
            onClick={() => void runImport()}
          >
            {importing ? t('gift.importing') : t('gift.importDetails')}
          </Button>

          <div role="status" aria-live="polite" className="text-sm text-muted">
            {importState.kind === 'done' &&
              importState.status === 'success' &&
              t('gift.importSuccess')}
            {importState.kind === 'done' &&
              importState.status === 'partial' &&
              t('gift.importPartial')}
            {importState.kind === 'done' &&
              importState.status === 'failed' &&
              (importState.reason === 'BLOCKED' ? t('gift.importBlocked') : t('gift.importFailed'))}
          </div>
          {importState.kind === 'error' && (
            <p role="alert" className="text-sm text-red-700">
              {t(`errors.api.${importState.code}`)}
            </p>
          )}
        </div>
      )}

      <TextField
        label={t('gift.titleLabel')}
        autoComplete="off"
        error={errors.title?.message}
        {...register('title')}
      />
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <TextField
          label={t('gift.priceLabel')}
          inputMode="decimal"
          autoComplete="off"
          error={errors.price?.message}
          {...register('price')}
        />
        <SelectField
          label={t('gift.currencyLabel')}
          error={errors.currency?.message}
          {...register('currency')}
        >
          {currencies.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </SelectField>
      </div>
      <TextField
        label={t('gift.imageUrlLabel')}
        type="url"
        inputMode="url"
        autoComplete="off"
        hint={t('gift.imageHint')}
        error={errors.imageUrl?.message}
        {...register('imageUrl')}
      />
      {isHttpUrl(imageUrl) && <ProductPreview key={imageUrl} imageUrl={imageUrl} title={title} />}
      <TextAreaField
        label={t('gift.descriptionLabel')}
        error={errors.description?.message}
        {...register('description')}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? t('common.saving') : submitLabel}
        </Button>
        <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}
