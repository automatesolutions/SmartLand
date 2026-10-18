import { useEffect, useState } from 'react'
import { authConfig } from './api'

// Google Identity Services: the "Sign in with Google" button and One Tap.
// https://developers.google.com/identity/gsi/web

interface GoogleId {
  initialize(config: {
    client_id: string
    callback: (response: { credential: string }) => void
    auto_select?: boolean
    cancel_on_tap_outside?: boolean
    context?: 'signin' | 'signup' | 'use'
    itp_support?: boolean
    use_fedcm_for_prompt?: boolean
  }): void
  renderButton(parent: HTMLElement, options: Record<string, string | number>): void
  prompt(): void
  cancel(): void
  disableAutoSelect(): void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } }
  }
}

const SCRIPT = 'https://accounts.google.com/gsi/client'

let ready: Promise<GoogleId | null> | null = null
// Google allows one initialize per page, so every button shares one callback
let handler: ((credential: string) => void) | null = null

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve()
    const el = document.createElement('script')
    el.src = SCRIPT
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => reject(new Error('Google sign-in script failed to load'))
    document.head.appendChild(el)
  })
}

/**
 * Loads Google sign-in once per visit. Resolves to null when the server has no
 * Google client ID, or the script is blocked (by an ad blocker, for example).
 */
export function loadGoogle(): Promise<GoogleId | null> {
  ready ??= authConfig()
    .then(async ({ google_client_id }) => {
      if (!google_client_id) return null
      await loadScript()
      const id = window.google!.accounts.id
      id.initialize({
        client_id: google_client_id,
        callback: (r) => handler?.(r.credential),
        // Signs returning people in without a click when they've used Google here before
        auto_select: true,
        cancel_on_tap_outside: true,
        context: 'signin',
        itp_support: true,
        use_fedcm_for_prompt: true,
      })
      return id
    })
    .catch(() => {
      ready = null
      return null
    })
  return ready
}

/** Routes the next Google sign-in to this page's handler */
export function onGoogleCredential(fn: ((credential: string) => void) | null) {
  handler = fn
}

/** After signing out, One Tap must ask again instead of signing the person straight back in */
export function stopGoogleAutoSignIn() {
  window.google?.accounts.id.disableAutoSelect()
}

/** Whether Google sign-in is offered: null while checking, then true or false */
export function useGoogleAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    loadGoogle().then((g) => live && setAvailable(g !== null))
    return () => {
      live = false
    }
  }, [])
  return available
}
