import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronRight, MonitorDown, Share, Smartphone, SquarePlus, X } from 'lucide-react'
import { dismissInstall, promptInstall, useInstall } from '../lib/install'
import { Button } from './Button'

// iPadOS reports itself as a Mac; touch gives it away
const onPhone = () =>
  /Android|iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)

/**
 * Adds SmartLand to the home screen where the browser allows it: Chrome's or Edge's own
 * dialog, or the Share menu steps on iPhone and iPad. Hidden once installed. The home
 * banner can be dismissed for 14 days; the Account row stays so people can still find it.
 */
export function InstallAppButton({ variant }: { variant: 'banner' | 'row' }) {
  const { how, dismissed } = useInstall()
  const [stepsOpen, setStepsOpen] = useState(false)
  if (!how || (variant === 'banner' && dismissed)) return null

  const phone = onPhone()
  const title = phone ? 'Add SmartLand to your phone' : 'Install SmartLand on this computer'
  const subtitle = phone ? 'Open it from your home screen, like an app.' : 'Open it in its own window.'
  const Icon = phone ? Smartphone : MonitorDown
  const install = () => (how === 'prompt' ? void promptInstall() : setStepsOpen(true))
  const steps = <IosSteps open={stepsOpen} onClose={() => setStepsOpen(false)} />

  if (variant === 'row') {
    return (
      <>
        <button
          type="button"
          onClick={install}
          aria-haspopup={how === 'ios' ? 'dialog' : undefined}
          className="press flex min-h-tap w-full items-center gap-md rounded-lg border border-hairline bg-surface p-md text-left hover:bg-surface-raised"
        >
          <Icon size={20} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{title}</span>
            <span className="block text-caption text-ink-secondary">{subtitle}</span>
          </span>
          <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
        </button>
        {steps}
      </>
    )
  }

  return (
    <div className="flex w-full max-w-reading items-center gap-xs rounded-lg border border-hairline bg-surface py-xs pl-md pr-xs">
      <button
        type="button"
        onClick={install}
        aria-haspopup={how === 'ios' ? 'dialog' : undefined}
        className="press flex min-h-tap min-w-0 flex-1 items-center gap-sm py-xs text-left"
      >
        <Icon size={22} strokeWidth={1.75} className="shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          <span className="block text-caption text-ink-secondary">{subtitle}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={dismissInstall}
        aria-label="Not now"
        className="press inline-flex size-tap shrink-0 items-center justify-center rounded-pill text-ink-secondary"
      >
        <X size={18} strokeWidth={1.75} aria-hidden />
      </button>
      {steps}
    </div>
  )
}

/** A bottom sheet with the Share menu steps, for Safari on iPhone and iPad */
function IosSteps({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // A tap on the dimmed backdrop lands on the dialog itself
      onClick={(e) => e.target === e.currentTarget && onClose()}
      aria-labelledby="install-steps-title"
      className="mx-auto mb-0 mt-auto w-full max-w-reading rounded-t-lg bg-surface p-0 text-left text-ink backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-lg px-lg pt-lg pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <h2 id="install-steps-title" className="text-tagline font-semibold">
          Add SmartLand to your Home Screen
        </h2>
        <ol className="flex flex-col gap-md">
          <Step n={1}>
            Tap the Share button <Share size={18} strokeWidth={1.75} className="inline align-[-3px] text-accent" aria-label="Share" />.
            <span className="block text-caption text-ink-secondary">If you don’t see Share, tap the More button first.</span>
          </Step>
          <Step n={2}>
            Tap Add to Home Screen <SquarePlus size={18} strokeWidth={1.75} className="inline align-[-3px] text-accent" aria-hidden />.
          </Step>
          <Step n={3}>Tap Add.</Step>
        </ol>
        <Button size="large" onClick={onClose}>
          Got it
        </Button>
      </div>
    </dialog>
  )
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <li className="flex gap-sm">
      <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-pill bg-surface-raised font-semibold text-accent">
        {n}
      </span>
      <span className="min-w-0 flex-1 pt-0.5">{children}</span>
    </li>
  )
}
