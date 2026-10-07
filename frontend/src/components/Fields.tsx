import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { CircleAlert } from 'lucide-react'

const control =
  'w-full rounded-sm border border-hairline bg-surface px-md text-body text-ink placeholder:text-ink-secondary transition-colors duration-200 ease-apple focus-visible:border-focus aria-[invalid=true]:border-critical'

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
  ...rest
}: { label: string; hint?: string; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
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
      <input id={id} aria-invalid={!!error} aria-describedby={describedBy} className={`${control} h-tap`} {...rest} />
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
        className={`${control} min-h-30 resize-y py-sm`}
        {...rest}
      />
    </div>
  )
}

/** Slider + number box for one model input */
export function RangeField({
  label,
  hint,
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
  const describedBy = [`${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ')
  return (
    <div className="flex flex-col gap-xxs">
      <div className="flex items-center justify-between gap-md">
        <label htmlFor={`${id}-num`} className="min-w-0 font-semibold">
          {label}
        </label>
        <div className="flex shrink-0 items-center gap-xxs">
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
            className={`${control} h-tap w-24 px-sm text-right tabular-nums`}
          />
          {unit && <span className="w-8 text-caption text-ink-secondary">{unit}</span>}
        </div>
      </div>
      <p id={`${id}-hint`} className="text-caption text-ink-secondary">
        {hint}
      </p>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number.isNaN(value) ? min : value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        aria-describedby={`${id}-hint`}
        className="range"
        style={{ ['--fill' as string]: fill }}
      />
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </div>
  )
}
