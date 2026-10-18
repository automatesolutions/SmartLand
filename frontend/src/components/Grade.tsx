import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react'
import type { Grade, Tone } from '../lib/format'

const icons = { positive: CircleCheck, caution: TriangleAlert, critical: CircleAlert }
const styles: Record<Tone, string> = {
  positive: 'bg-positive-soft text-positive',
  caution: 'bg-caution-soft text-caution',
  critical: 'bg-critical-soft text-critical',
}
// On a dark tile the light-mode status colours fail contrast, so use the dark ones
const tileStyles: Record<Tone, string> = {
  positive: 'bg-tile-hairline text-positive-on-tile',
  caution: 'bg-tile-hairline text-caution-on-tile',
  critical: 'bg-tile-hairline text-critical-on-tile',
}

/** Grade chip: colour + icon + text, never colour alone */
export function GradeBadge({
  grade,
  size = 'default',
  onTile = false,
}: {
  grade: Grade
  size?: 'default' | 'large'
  onTile?: boolean
}) {
  const Icon = icons[grade.tone]
  return (
    <span
      className={`inline-flex items-center gap-xs rounded-pill font-semibold ${(onTile ? tileStyles : styles)[grade.tone]} ${
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

function scoreTone(value: number, max: number, invert: boolean): { pct: number; tone: Tone } {
  const pct = Math.max(0, Math.min(100, (value / max) * 100))
  const good = invert ? 100 - pct : pct
  return { pct, tone: good >= 60 ? 'positive' : good >= 40 ? 'caution' : 'critical' }
}

function shownValue(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
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
  const { pct, tone } = scoreTone(value, max, invert)
  const bar = { positive: 'bg-positive', caution: 'bg-caution', critical: 'bg-critical' }[tone]
  const shown = shownValue(value)
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

const RING_R = 52
const RING_LENGTH = 2 * Math.PI * RING_R
const ringStroke: Record<Tone, string> = { positive: 'stroke-positive', caution: 'stroke-caution', critical: 'stroke-critical' }
const toneWord: Record<Tone, string> = { positive: 'Good', caution: 'Fair', critical: 'Weak' }

/** Activity-style ring for one score, with the number in the middle */
export function Ring({
  label,
  value,
  max,
  hint,
  invert = false,
  status,
}: {
  label: string
  value: number
  max: number
  hint?: string
  invert?: boolean
  /** Overrides the tone and word worked out from the value, for scores with their own levels */
  status?: { tone: Tone; word: string }
}) {
  const auto = scoreTone(value, max, invert)
  const pct = auto.pct
  const tone = status?.tone ?? auto.tone
  const word = status?.word ?? toneWord[tone]
  const shown = shownValue(value)
  const offset = RING_LENGTH * (1 - pct / 100)
  const Icon = icons[tone]
  return (
    <div className="flex flex-col items-center gap-sm text-center">
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Number(shown)}
        aria-valuetext={`${shown} of ${max}, ${word.toLowerCase()}`}
        className="relative size-36"
      >
        <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
          <circle cx="60" cy="60" r={RING_R} fill="none" strokeWidth="10" className="stroke-hairline" />
          <circle
            cx="60"
            cy="60"
            r={RING_R}
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={RING_LENGTH}
            strokeDashoffset={offset}
            className={`${ringStroke[tone]} animate-ring`}
            style={{ ['--ring-from' as string]: RING_LENGTH }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-display-sm tabular-nums">{shown}</span>
          <span className="text-fine-print text-ink-secondary">of {max}</span>
        </div>
      </div>
      <div className="flex flex-col items-center gap-xxs">
        <p className="font-semibold">{label}</p>
        <p className={`inline-flex items-center gap-xxs text-caption font-semibold ${{ positive: 'text-positive', caution: 'text-caution', critical: 'text-critical' }[tone]}`}>
          <Icon size={14} strokeWidth={2.25} aria-hidden />
          {word}
        </p>
        {hint && <p className="max-w-56 text-caption text-ink-secondary">{hint}</p>}
      </div>
    </div>
  )
}
