import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { TextAreaField, TextField } from '@/components/ui/text-field'
import { wishlistFormSchema, type WishlistFormValues } from '@/lib/validation'

export function WishlistForm({
  initialValues = { title: '', description: '' },
  submitLabel,
  pending,
  onSubmit,
}: {
  initialValues?: WishlistFormValues
  submitLabel: string
  pending: boolean
  onSubmit: (values: WishlistFormValues) => void
}) {
  const { t } = useTranslation()
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<WishlistFormValues>({
    resolver: zodResolver(wishlistFormSchema),
    defaultValues: initialValues,
  })

  return (
    <form onSubmit={(event) => void handleSubmit(onSubmit)(event)} noValidate className="space-y-4">
      <TextField
        label={t('wishlist.titleLabel')}
        autoComplete="off"
        error={errors.title?.message}
        {...register('title')}
      />
      <TextAreaField
        label={t('wishlist.descriptionLabel')}
        error={errors.description?.message}
        {...register('description')}
      />
      <Button type="submit" disabled={pending} aria-busy={pending}>
        {pending ? t('common.saving') : submitLabel}
      </Button>
    </form>
  )
}
