import { useSyncExternalStore } from 'react'
import { configureAuth, signInRequest, type User } from './api'

// The session lives in localStorage so it survives reloads. Reads are guarded
// because storage can be blocked; the person then stays signed in for this visit.

interface Session {
  token: string
  user: User
}

const KEY = 'smartland:session'

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed.token === 'string' ? parsed : null
  } catch {
    return null
  }
}

let session = readSession()
const listeners = new Set<() => void>()

function setSession(next: Session | null) {
  session = next
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next))
    else localStorage.removeItem(KEY)
  } catch {
    // Storage blocked: the session still works until the tab closes
  }
  configureAuth(next?.token ?? null, signOut)
  listeners.forEach((l) => l())
}

configureAuth(session?.token ?? null, signOut)

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) setSession(readSession())
  })
}

export function subscribeAuth(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function currentUser(): User | null {
  return session?.user ?? null
}

export function useUser(): User | null {
  return useSyncExternalStore(subscribeAuth, currentUser, currentUser)
}

export async function signIn(mode: 'login' | 'register', email: string, password: string, name?: string) {
  const { token, user } = await signInRequest(mode, email.trim(), password, name?.trim())
  setSession({ token, user })
  return user
}

export function signOut() {
  setSession(null)
}
