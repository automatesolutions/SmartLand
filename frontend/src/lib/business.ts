import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { businessApi, crmApi, type Crm, type InviteRole, type LeadSummary, type Org, type OrgKind, type OrgRole } from './api'
import { useUser } from './auth'

export const KIND_LABEL: Record<OrgKind, string> = {
  brokerage: 'Real estate brokerage',
  developer: 'Developer',
  agency: 'Agency or team',
  other: 'Other business',
}

export const ROLE_LABEL: Record<OrgRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  guest: 'Guest',
}

export const ROLE_HINT: Record<InviteRole, string> = {
  admin: 'Manages the team and every listing',
  member: 'Posts listings and works leads',
  guest: 'Sees the business account, can’t change it',
}

const YOU_ARE: Record<Org['role'], string> = {
  owner: 'You’re the owner',
  admin: 'You’re an admin',
  member: 'You’re a member',
  guest: 'You’re a guest',
}

/** "Real estate brokerage · PRC 0012345 · You're the owner" */
export function orgLine(org: Org) {
  if (org.kind === 'personal') return 'Inquiries on the listings you post as yourself'
  return [KIND_LABEL[org.kind], org.prc_license && `PRC ${org.prc_license}`, YOU_ARE[org.role]]
    .filter(Boolean)
    .join(' · ')
}

export const canManage = (role: OrgRole | undefined) => role === 'owner' || role === 'admin'

/** The business accounts you're on, newest data each time the signed-in person changes.
 * With `personal`, your own CRM is included too, and made the first time. */
export function useMyOrgs({ personal = false }: { personal?: boolean } = {}) {
  const user = useUser()
  const [state, setState] = useState<{ userId: string; orgs: Org[] | null; failed: boolean } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!user) return
    let live = true
    businessApi
      .mine()
      .then(async (orgs) => (personal && !orgs.some((o) => o.kind === 'personal') ? [...orgs, await businessApi.personal()] : orgs))
      .then((orgs) => live && setState({ userId: user.id, orgs, failed: false }))
      .catch(() => live && setState({ userId: user.id, orgs: null, failed: true }))
    return () => {
      live = false
    }
  }, [user, attempt, personal])

  const current = state?.userId === user?.id ? state : null
  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  // Personal CRMs aren't business accounts: they only show where leads are worked
  const orgs = current?.orgs?.filter((o) => personal || o.kind !== 'personal') ?? null
  return { orgs, failed: current?.failed ?? false, reload }
}

/** The CRM board for one org: stages, leads, and who can be assigned */
export function useCrm(orgId: string | undefined) {
  const [state, setState] = useState<{ orgId: string; crm: Crm | null; failed: boolean } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!orgId) return
    const controller = new AbortController()
    crmApi
      .board(orgId, controller.signal)
      .then((crm) => setState({ orgId, crm, failed: false }))
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') setState({ orgId, crm: null, failed: true })
      })
    return () => controller.abort()
  }, [orgId, attempt])

  const current = state?.orgId === orgId ? state : null
  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  /** Shows a change right away, before the server answers */
  const patchLead = useCallback(
    (id: string, change: Partial<LeadSummary>) =>
      setState((s) => (s?.crm ? { ...s, crm: { ...s.crm, leads: s.crm.leads.map((l) => (l.id === id ? { ...l, ...change } : l)) } } : s)),
    [],
  )
  return { crm: current?.crm ?? null, failed: current?.failed ?? false, reload, patchLead }
}

export const canWorkLeads = (role: OrgRole | undefined) => role === 'owner' || role === 'admin' || role === 'member'

/** Today on this device, as YYYY-MM-DD */
export function today(): string {
  return new Date().toLocaleDateString('en-CA')
}

/** "Today", "Tomorrow", "Overdue since Nov 24", or "Dec 2" for a YYYY-MM-DD follow-up date */
export function followUpLabel(on: string): string {
  const t = today()
  const day = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(new Date(`${on}T00:00:00`))
  if (on === t) return 'Today'
  if (on < t) return `Overdue since ${day}`
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (on === tomorrow.toLocaleDateString('en-CA')) return 'Tomorrow'
  return day
}

/** Open leads with a follow-up due today or earlier, oldest first */
export function dueLeads(leads: LeadSummary[]): LeadSummary[] {
  const t = today()
  return leads
    .filter((l) => !l.closed_at && l.follow_up_on && l.follow_up_on <= t)
    .sort((a, b) => a.follow_up_on!.localeCompare(b.follow_up_on!))
}

/** The heading for an org: personal CRMs get a friendlier one */
export const orgTitle = (org: Org) => (org.kind === 'personal' ? 'Your leads' : org.name)

// Which business account /business shows, remembered on this device
const KEY = 'smartland:org'
const listeners = new Set<() => void>()

function readPicked(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

let picked = readPicked()

export function pickOrg(id: string) {
  picked = id
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // Storage blocked: the choice lasts for this visit
  }
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** The picked org if you're still on it, else your first one */
export function useCurrentOrg(orgs: Org[] | null): Org | null {
  const id = useSyncExternalStore(subscribe, () => picked, () => picked)
  if (!orgs?.length) return null
  return orgs.find((o) => o.id === id) ?? orgs[0]
}
