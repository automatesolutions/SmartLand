import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react'
import type { Grade, Tone } from '../lib/format'

const icons = { positive: CircleCheck, caution: TriangleAlert, critical: CircleAlert }
const styles: Record<Tone, string> = {
  positive: 'bg-positive-soft text-positive',
  caution: 'bg-caution-soft text-caution',
  critical: 'bg-critical-soft text-critical',
}

/** Grade chip: colour + icon + text, never colour alone */
export function GradeBadge({ grade, size = 'default' }: { grade: Grade; size?: 'default' | 'large' }) {
  const Icon = icons[grade.tone]
  return (
    <span
      className={`inline-flex items-center gap-xs rounded-pill font-semibold ${styles[grade.tone]} ${
        size === 'large' ? 'px-md py-xs text-body' : 'px-sm py-xxs text-caption'
      }`}
    >
      <Icon size={size === 'large' ? 18 : 16} strokeWidth={2.25} aria-hidden />
      <span>
        {grade.grade}
        <span className="sr-only">,</span> <span className="font-regular">{grade.label}</span>
      </span>
    </span>
  )
}

/** Horizontal meter for 0..max scores */
export function Meter({
  label,
  value,
  max,
  hint,
  invert = false,
}: {
  label: string
  value: number
  max: number
  hint?: string
  invert?: boolean
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const good = invert ? 100 - pct : pct
  const tone: Tone = good >= 60 ? 'positive' : good >= 40 ? 'caution' : 'critical'
  const bar = { positive: 'bg-positive', caution: 'bg-caution', critical: 'bg-critical' }[tone]
  const shown = Number.isInteger(value) ? value : value.toFixed(1)
  return (
    <div className="flex flex-col gap-xs">
      <div className="flex items-baseline justify-between gap-sm">
        <span className="font-semibold">{label}</span>
        <span className="tabular-nums text-ink-secondary">
          {shown} <span className="text-caption">of {max}</span>
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Number(shown)}
        className="h-1.5 overflow-hidden rounded-pill bg-hairline"
      >
        <div className={`h-full rounded-pill ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      {hint && <p className="text-caption text-ink-secondary">{hint}</p>}
    </div>
  )
}
