import { useSyncExternalStore } from 'react'
import { api, type AnalyzeInput, type AnalyzeResult } from './api'
import { currentUser, subscribeAuth } from './auth'

// Fresh reports go to sessionStorage until saved. Saved reports go to
// localStorage, and when someone is signed in they also sync to their account,
// so they show up on every device. Storage reads are guarded because storage
// can be blocked (private mode, disabled site data).

export interface Report {
  id: string
  createdAt: string
  input: AnalyzeInput
  result: AnalyzeResult
  /** Set when a public link exists. Only reports in an account can be shared. */
  shareToken?: string | null
}

export type SyncState = 'local' | 'syncing' | 'synced' | 'error'

const SAVED_KEY = 'smartland:saved-reports'
const DRAFT_KEY = 'smartland:draft-reports'

function read(storage: () => Storage, key: string): Report[] {
  try {
    const raw = storage().getItem(key)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(storage: () => Storage, key: string, reports: Report[]): boolean {
  try {
    storage().setItem(key, JSON.stringify(reports))
    return true
  } catch {
    return false
  }
}

const local = () => window.localStorage
const session = () => window.sessionStorage

const listeners = new Set<() => void>()
let savedSnapshot = read(local, SAVED_KEY)
let syncState: SyncState = currentUser() ? 'syncing' : 'local'

function emit() {
  savedSnapshot = read(local, SAVED_KEY)
  listeners.forEach((l) => l())
}

function setSync(next: SyncState) {
  syncState = next
  listeners.forEach((l) => l())
}

/**
 * Two-way merge with the account: upload reports that only exist here,
 * then take the account's list as the source of truth.
 */
async function syncWithAccount() {
  if (!currentUser()) {
    setSync('local')
    return
  }
  setSync('syncing')
  try {
    const remote = await api.listReports<Report>()
    const remoteIds = new Set(remote.map((r) => r.id))
    const localOnly = read(local, SAVED_KEY).filter((r) => !remoteIds.has(r.id))
    await Promise.all(localOnly.map((r) => api.putReport(stripShare(r))))
    const merged = [...localOnly, ...remote].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    write(local, SAVED_KEY, merged)
    emit()
    setSync('synced')
  } catch {
    setSync('error')
  }
}

function stripShare(r: Report): Report {
  const { shareToken: _ignored, ...rest } = r
  return rest
}

if (typeof window !== 'undefined') {
  // Keep tabs in sync
  window.addEventListener('storage', (e) => {
    if (e.key === SAVED_KEY) emit()
  })
  let lastUser = currentUser()?.id ?? null
  subscribeAuth(() => {
    const id = currentUser()?.id ?? null
    if (id === lastUser) return
    if (lastUser && !id) {
      // Signed out: the account's reports stay in the account, not on this device
      write(local, SAVED_KEY, [])
      emit()
    }
    lastUser = id
    void syncWithAccount()
  })
  void syncWithAccount()
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useSavedReports(): Report[] {
  return useSyncExternalStore(subscribe, () => savedSnapshot, () => savedSnapshot)
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribe, () => syncState, () => syncState)
}

export function retrySync() {
  void syncWithAccount()
}

export function newReportId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10)
}

export function storeDraft(report: Report) {
  const drafts = read(session, DRAFT_KEY).filter((r) => r.id !== report.id)
  write(session, DRAFT_KEY, [report, ...drafts].slice(0, 20))
}

export function findReport(id: string): { report: Report; saved: boolean } | null {
  const saved = read(local, SAVED_KEY).find((r) => r.id === id)
  if (saved) return { report: saved, saved: true }
  const draft = read(session, DRAFT_KEY).find((r) => r.id === id)
  return draft ? { report: draft, saved: false } : null
}

function upsertLocal(report: Report): boolean {
  const saved = read(local, SAVED_KEY).filter((r) => r.id !== report.id)
  const ok = write(local, SAVED_KEY, [report, ...saved])
  emit()
  return ok
}

/** Saves on this device, and to the account when signed in. */
export async function saveReport(report: Report): Promise<'device' | 'account' | 'failed'> {
  if (currentUser()) {
    try {
      await api.putReport(stripShare(report))
      upsertLocal(report)
      return 'account'
    } catch {
      // Keep it here and upload on the next sync
      return upsertLocal(report) ? 'device' : 'failed'
    }
  }
  return upsertLocal(report) ? 'device' : 'failed'
}

export async function deleteReport(id: string): Promise<boolean> {
  if (currentUser()) {
    try {
      await api.deleteReport(id)
    } catch {
      return false
    }
  }
  const ok = write(local, SAVED_KEY, read(local, SAVED_KEY).filter((r) => r.id !== id))
  emit()
  return ok
}

export async function setShared(report: Report, shared: boolean): Promise<string | null> {
  let token: string | null = null
  if (shared) token = (await api.shareReport(report.id)).token
  else await api.unshareReport(report.id)
  upsertLocal({ ...report, shareToken: token })
  return token
}
