import { useSyncExternalStore } from 'react'

// Adding SmartLand to the home screen (public/manifest.webmanifest).
// Chrome and Edge send `beforeinstallprompt` when SmartLand can be installed, sometimes
// before React loads, so a script in index.html keeps the event on window.
// Safari on iPhone and iPad never sends it; there people add SmartLand from the Share menu.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

declare global {
  interface Window {
    __installPrompt?: BeforeInstallPromptEvent | null
  }
  interface Navigator {
    standalone?: boolean
  }
}

const DISMISS_KEY = 'smartland:install-dismissed'
const DISMISS_MS = 14 * 24 * 60 * 60 * 1000

/** "prompt": Chrome or Edge can install. "ios": show the Share menu steps. null: hide. */
export type InstallHow = 'prompt' | 'ios' | null

interface InstallState {
  how: InstallHow
  /** Dismissed in the last 14 days */
  dismissed: boolean
}

const HIDDEN: InstallState = { how: null, dismissed: true }

let state = HIDDEN
let installed = false
let started = false
const listeners = new Set<() => void>()

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
}

function isIos() {
  const ua = navigator.userAgent
  // iPadOS reports itself as a Mac; touch gives it away
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  // Facebook, Instagram, and LINE open links in their own browser, which can't add to the home screen
  return ios && !/FBAN|FBAV|Instagram|Line\//.test(ua)
}

function dismissedRecently() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY))
    return at > 0 && Date.now() - at < DISMISS_MS
  } catch {
    return false
  }
}

function update() {
  const how: InstallHow = installed || isStandalone() ? null : window.__installPrompt ? 'prompt' : isIos() ? 'ios' : null
  const dismissed = dismissedRecently()
  if (how !== state.how || dismissed !== state.dismissed) state = { how, dismissed }
  listeners.forEach((l) => l())
}

function start() {
  if (started) return
  started = true
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    window.__installPrompt = e as BeforeInstallPromptEvent
    update()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    window.__installPrompt = null
    update()
  })
  update()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  start()
  return () => listeners.delete(listener)
}

export function useInstall(): InstallState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => HIDDEN,
  )
}

/** Hides the home banner for 14 days */
export function dismissInstall() {
  try {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
  } catch {
    // Storage blocked: the banner hides for this visit only
  }
  update()
}

/** Opens Chrome's or Edge's install dialog. Each saved event opens it once. */
export async function promptInstall() {
  const event = window.__installPrompt
  if (!event) return
  window.__installPrompt = null
  try {
    await event.prompt()
    const { outcome } = await event.userChoice
    if (outcome === 'accepted') installed = true
    else dismissInstall()
  } catch {
    // Chrome refused to show its dialog; the button hides until Chrome offers again
  }
  update()
}
