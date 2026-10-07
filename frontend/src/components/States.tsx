import type { ReactNode } from 'react'
import { CircleAlert, CircleCheck, TriangleAlert, X, type LucideIcon } from 'lucide-react'
import { toneText, type Tone } from '../lib/format'

/** Empty state: icon, why it's empty, one action */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  as: Heading = 'h2',
}: {
  icon: LucideIcon
  title: string
  body: string
  action?: ReactNode
  as?: 'h1' | 'h2'
}) {
  return (
    <div className="mx-auto flex max-w-form flex-col items-center gap-md px-md py-section text-center">
      <span className="inline-flex size-16 items-center justify-center rounded-pill bg-surface-raised text-ink-secondary">
        <Icon size={28} strokeWidth={1.5} aria-hidden />
      </span>
      <div className="flex flex-col gap-xs">
        <Heading className="text-tagline font-semibold">{title}</Heading>
        <p className="text-ink-secondary">{body}</p>
      </div>
      {action}
    </div>
  )
}

const toneStyles: Record<Tone, { box: string; icon: LucideIcon }> = {
  positive: { box: 'bg-positive-soft', icon: CircleCheck },
  caution: { box: 'bg-caution-soft', icon: TriangleAlert },
  critical: { box: 'bg-critical-soft', icon: CircleAlert },
}

/** Inline banner for errors and success. Never auto-dismissed. */
export function Banner({
  tone,
  title,
  children,
  action,
  onDismiss,
}: {
  tone: Tone
  title: string
  children?: ReactNode
  action?: ReactNode
  onDismiss?: () => void
}) {
  const { box, icon: Icon } = toneStyles[tone]
  return (
    <div
      role={tone === 'critical' ? 'alert' : 'status'}
      className={`flex items-start gap-sm rounded-lg ${box} p-md`}
    >
      <Icon size={22} strokeWidth={2} className={`mt-px shrink-0 ${toneText[tone]}`} aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-xxs">
        <p className="font-semibold">{title}</p>
        {children && <div className="text-ink">{children}</div>}
        {action && <div className="mt-xs">{action}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="press -m-sm inline-flex size-tap shrink-0 items-center justify-center rounded-pill text-ink-secondary"
        >
          <X size={18} aria-hidden />
        </button>
      )}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`animate-shimmer rounded-sm bg-surface-raised ${className}`} />
}

