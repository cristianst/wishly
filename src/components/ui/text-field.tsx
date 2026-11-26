import { useId, type ComponentProps, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

const controlClass =
  'w-full rounded-xl bg-canvas px-4 ring-1 ring-field focus:ring-brand aria-[invalid=true]:ring-red-600'

interface FieldProps {
  label: string
  /** A translation key (e.g. from a zod schema) or undefined. */
  error?: string | undefined
  hint?: ReactNode
}

function Shell({
  id,
  label,
  error,
  hint,
  children,
}: FieldProps & { id: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-red-700">
          {t(error)}
        </p>
      )}
    </div>
  )
}

export function TextField({
  label,
  error,
  hint,
  className,
  ...props
}: FieldProps & ComponentProps<'input'>) {
  const id = useId()
  return (
    <Shell id={id} label={label} error={error} hint={hint}>
      <input
        id={id}
        className={cn(controlClass, 'min-h-11', className)}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...props}
      />
    </Shell>
  )
}

export function TextAreaField({
  label,
  error,
  hint,
  className,
  ...props
}: FieldProps & ComponentProps<'textarea'>) {
  const id = useId()
  return (
    <Shell id={id} label={label} error={error} hint={hint}>
      <textarea
        id={id}
        rows={3}
        className={cn(controlClass, 'py-3', className)}
        aria-invalid={error ? 'true' : 'false'}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...props}
      />
    </Shell>
  )
}

export function SelectField({
  label,
  error,
  hint,
  className,
  children,
  ...props
}: FieldProps & ComponentProps<'select'>) {
  const id = useId()
  return (
    <Shell id={id} label={label} error={error} hint={hint}>
      <select id={id} className={cn(controlClass, 'min-h-11', className)} {...props}>
        {children}
      </select>
    </Shell>
  )
}
