import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { CircleAlert } from 'lucide-react'

const control =
  'w-full border border-hairline bg-surface px-md text-body text-ink placeholder:text-ink-secondary transition-colors duration-200 ease-apple focus-visible:border-focus aria-[invalid=true]:border-critical'

function FieldError({ id, children }: { id: string; children?: ReactNode }) {
  if (!children) return null
  return (
    <p id={id} className="flex items-center gap-xxs text-caption text-critical">
      <CircleAlert size={16} strokeWidth={2} aria-hidden />
      {children}
    </p>
  )
}

export function TextField({
  label,
  hint,
  error,
  search = false,
  ...rest
}: { label: string; hint?: string; error?: string; search?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
  return (
    <div className="flex flex-col gap-xs">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-caption text-ink-secondary">
          {hint}
        </p>
      )}
      <input id={id} aria-invalid={!!error} aria-describedby={describedBy} className={`${control} h-tap ${search ? 'rounded-pill px-lg' : 'rounded-sm'}`} {...rest} />
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  )
}

export function TextArea({
  label,
  hint,
  ...rest
}: { label: string; hint?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId()
  return (
    <div className="flex flex-col gap-xs">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-caption text-ink-secondary">
          {hint}
        </p>
      )}
      <textarea
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={`${control} min-h-30 resize-y rounded-sm py-sm`}
        {...rest}
      />
    </div>
  )
}

/** Slider + number box for one model input, laid out as a row in a list */
export function RangeField({
  label,
  hint,
  note,
  icon,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  error,
}: {
  label: string
  hint: string
  /** Where the value came from, shown as a chip under the slider */
  note?: string
  icon?: ReactNode
  value: number
  min: number
  max: number
  step: number
  unit?: string
  onChange: (v: number) => void
  error?: string
}) {
  const id = useId()
  const fill = `${((value - min) / (max - min)) * 100}%`
  const describedBy = [`${id}-hint`, note && `${id}-note`, error && `${id}-error`].filter(Boolean).join(' ')
  return (
    <div className="flex flex-col gap-xxs border-b border-hairline py-md first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex items-center gap-sm">
        {icon && (
          <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-surface-raised text-ink-secondary">
            {icon}
          </span>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <label htmlFor={`${id}-num`} className="font-semibold">
            {label}
          </label>
          <p id={`${id}-hint`} className="text-caption text-ink-secondary">
            {hint}
          </p>
        </div>
        <div className="flex shrink-0 items-baseline gap-xxs">
          <input
            id={`${id}-num`}
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={step}
            value={Number.isNaN(value) ? '' : value}
            onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
            aria-invalid={!!error}
            aria-describedby={describedBy}
            className="h-tap w-20 rounded-sm border border-transparent bg-surface-raised px-xs text-right text-tagline font-semibold tabular-nums text-ink transition-colors duration-200 ease-apple hover:border-hairline focus-visible:border-focus aria-[invalid=true]:border-critical"
          />
          <span className="w-6 text-caption text-ink-secondary">{unit}</span>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number.isNaN(value) ? min : value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        aria-describedby={describedBy}
        className="range"
        style={{ ['--fill' as string]: fill }}
      />
      {note && (
        <p id={`${id}-note`} className="-mt-xxs self-start rounded-pill bg-surface-raised px-sm py-xxs text-fine-print text-ink-secondary">
          {note}
        </p>
      )}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  )
}
