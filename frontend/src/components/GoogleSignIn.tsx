import { useEffect, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { ApiError } from '../lib/api'
import { signInWithGoogle } from '../lib/auth'
import { loadGoogle, onGoogleCredential } from '../lib/google'

/**
 * Google's "Continue with Google" button. With `oneTap`, Google also shows its
 * One Tap prompt, which signs returning people in automatically. Renders
 * nothing when the server has no Google client ID.
 */
export function GoogleSignIn({ oneTap = false, onSignedIn }: { oneTap?: boolean; onSignedIn?: () => void }) {
  const slot = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'off' | 'signing-in'>('loading')
  const [error, setError] = useState<string | null>(null)
  const done = useRef(onSignedIn)

  useEffect(() => {
    done.current = onSignedIn
  }, [onSignedIn])

  useEffect(() => {
    let live = true
    onGoogleCredential(async (credential) => {
      setState('signing-in')
      setError(null)
      try {
        await signInWithGoogle(credential)
        done.current?.()
      } catch (err) {
        if (!live) return
        setState('ready')
        setError(
          err instanceof ApiError && err.kind === 'unauthorized'
            ? err.detail ?? "Google sign-in didn't go through. Try again."
            : err instanceof ApiError && err.kind === 'rate-limited'
              ? 'Too many tries. Wait a few minutes, then try again.'
              : "We couldn't reach SmartLand. Check your connection, then try again.",
        )
      }
    })

    loadGoogle().then((google) => {
      if (!live) return
      if (!google || !slot.current) {
        setState('off')
        return
      }
      google.renderButton(slot.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        logo_alignment: 'left',
        // Match the site's language, not the browser's
        locale: 'en',
        width: Math.min(400, slot.current.offsetWidth || 320),
      })
      setState('ready')
      if (oneTap) google.prompt()
    })

    return () => {
      live = false
      onGoogleCredential(null)
      if (oneTap) window.google?.accounts.id.cancel()
    }
  }, [oneTap])

  if (state === 'off') return null
  return (
    <div className="flex flex-col gap-xs">
      <div ref={slot} className={`min-h-tap w-full max-w-100 ${state === 'loading' ? 'hidden' : ''} ${state === 'signing-in' ? 'pointer-events-none opacity-50' : ''}`} />
      {state === 'loading' && <div aria-hidden className="h-tap w-full max-w-100 animate-shimmer rounded-pill bg-surface-raised" />}
      {state === 'signing-in' && (
        <p role="status" className="inline-flex items-center gap-xs text-caption text-ink-secondary">
          <LoaderCircle size={14} className="animate-spin" aria-hidden />
          Signing you in with Google
        </p>
      )}
      {error && (
        <p role="alert" className="text-caption text-critical">
          {error}
        </p>
      )}
    </div>
  )
}
