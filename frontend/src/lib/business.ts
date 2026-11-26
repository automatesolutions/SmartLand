import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { businessApi, type InviteRole, type Org, type OrgKind, type OrgRole } from './api'
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
  return [org.kind === 'personal' ? 'Personal CRM' : KIND_LABEL[org.kind], org.prc_license && `PRC ${org.prc_license}`, YOU_ARE[org.role]]
    .filter(Boolean)
    .join(' · ')
}

export const canManage = (role: OrgRole | undefined) => role === 'owner' || role === 'admin'

/** The business accounts you're on, newest data each time the signed-in person changes */
export function useMyOrgs() {
  const user = useUser()
  const [state, setState] = useState<{ userId: string; orgs: Org[] | null; failed: boolean } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!user) return
    let live = true
    businessApi
      .mine()
      .then((orgs) => live && setState({ userId: user.id, orgs, failed: false }))
      .catch(() => live && setState({ userId: user.id, orgs: null, failed: true }))
    return () => {
      live = false
    }
  }, [user, attempt])

  const current = state?.userId === user?.id ? state : null
  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  // Personal CRMs aren't business accounts: they never show here
  return { orgs: current?.orgs?.filter((o) => o.kind !== 'personal') ?? null, failed: current?.failed ?? false, reload }
}

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
