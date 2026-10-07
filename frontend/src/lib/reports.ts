import { useSyncExternalStore } from 'react'
import type { AnalyzeInput, AnalyzeResult } from './api'

// Reports live in the browser. Fresh reports go to sessionStorage until saved;
// saved reports go to localStorage. Both reads are guarded because storage
// can be blocked (private mode, disabled site data).

export interface Report {
  id: string
  createdAt: string
  input: AnalyzeInput
  result: AnalyzeResult
}

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

function emit() {
  savedSnapshot = read(local, SAVED_KEY)
  listeners.forEach((l) => l())
}

if (typeof window !== 'undefined') {
  // Keep tabs in sync
  window.addEventListener('storage', (e) => {
    if (e.key === SAVED_KEY) emit()
  })
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useSavedReports(): Report[] {
  return useSyncExternalStore(subscribe, () => savedSnapshot, () => savedSnapshot)
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

export function saveReport(report: Report): boolean {
  const saved = read(local, SAVED_KEY).filter((r) => r.id !== report.id)
  const ok = write(local, SAVED_KEY, [report, ...saved])
  emit()
  return ok
}

export function deleteReport(id: string): boolean {
  const ok = write(local, SAVED_KEY, read(local, SAVED_KEY).filter((r) => r.id !== id))
  emit()
  return ok
}
