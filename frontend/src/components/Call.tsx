import { lazy, Suspense } from 'react'
import type { CallRoomProps } from './CallRoom'

export type { LeaveReason } from './CallRoom'

// LiveKit's library loads only when a call opens, so other pages stay small
const CallRoom = lazy(() => import('./CallRoom'))

export function Call(props: CallRoomProps) {
  return (
    <Suspense
      fallback={
        <div role="status" className="fixed inset-0 z-50 flex items-center justify-center bg-black text-on-tile">
          Opening the call
        </div>
      }
    >
      <CallRoom {...props} />
    </Suspense>
  )
}
