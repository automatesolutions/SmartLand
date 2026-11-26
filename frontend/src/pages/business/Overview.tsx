import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { BarChart3, Building2, CalendarClock, ChevronRight, Inbox, ListChecks, MessagesSquare, Plus, UsersRound } from 'lucide-react'
import { workspaceApi, type Crm, type Org } from '../../lib/api'
import { useUser } from '../../lib/auth'
import { canManage, dueLeads, followUpLabel, orgLine, orgTitle, today, useCrm, useCurrentOrg, useMyOrgs } from '../../lib/business'
import { ButtonLink } from '../../components/Button'
import { Skeleton } from '../../components/States'
import { LoadFailed, OrgSwitcher, SignInFor } from './Shared'

const card = 'press flex min-h-tap items-center gap-md rounded-lg border border-hairline bg-surface p-md hover:bg-surface-raised'

function FollowUps({ crm }: { crm: Crm }) {
  const due = dueLeads(crm.leads)
  const t = today()
  return (
    <section aria-labelledby="due-heading" className="flex flex-col gap-sm">
      <h2 id="due-heading" className="text-tagline font-semibold">
        Follow-ups
      </h2>
      {due.length === 0 ? (
        <p className="text-ink-secondary">Nothing due today. Set a follow-up date on a lead and it shows here on the day.</p>
      ) : (
        <ul className="flex flex-col gap-xs">
          {due.map((l) => (
            <li key={l.id}>
              <Link to={`/business/leads/${l.id}`} className={card}>
                <CalendarClock size={20} strokeWidth={1.75} className={`shrink-0 ${l.follow_up_on! < t ? 'text-critical' : 'text-ink-secondary'}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{l.contact_name}</span>
                  <span className="block truncate text-caption text-ink-secondary">
                    {followUpLabel(l.follow_up_on!)} · {l.stage}
                    {l.listing ? ` · ${l.listing.title}` : ''}
                  </span>
                </span>
                <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function LeadsCard({ crm }: { crm: Crm }) {
  const open = crm.leads.filter((l) => !l.closed_at)
  const unread = crm.leads.reduce((n, l) => n + l.unread, 0)
  const counts = crm.stages.filter((s) => !s.outcome).map((s) => ({ name: s.name, n: open.filter((l) => l.stage_id === s.id).length }))
  return (
    <Link to="/business/leads" className={card}>
      <Inbox size={22} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">
          Leads{unread > 0 && <span className="ml-xs rounded-pill bg-accent-fill px-xs text-caption text-on-accent">{unread} new {unread === 1 ? 'message' : 'messages'}</span>}
        </span>
        <span className="block text-caption text-ink-secondary">
          {open.length === 0 ? 'No open leads yet. Buyers who message you about a listing show up here.' : counts.map((c) => `${c.name} ${c.n}`).join(' · ')}
        </span>
      </span>
      <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
    </Link>
  )
}

/** Team chat and tasks: new DMs and mentions, and your open tasks due by today */
function TeamCards({ org }: { org: Org }) {
  const [counts, setCounts] = useState<{ orgId: string; chat: number; due: number; open: number } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([workspaceApi.unread(controller.signal), workspaceApi.tasks(org.id, { status: 'open', mine: true }, controller.signal)])
      .then(([unread, tasks]) =>
        setCounts({
          orgId: org.id,
          chat: unread.by_org[org.id] ?? 0,
          open: tasks.length,
          due: tasks.filter((t) => t.due_on && t.due_on <= today()).length,
        }),
      )
      .catch(() => {
        // The cards still link through without counts
      })
    return () => controller.abort()
  }, [org.id])

  const c = counts?.orgId === org.id ? counts : null
  return (
    <>
      <Link to="/business/workspace" className={card}>
        <MessagesSquare size={22} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">
            Team chat
            {c && c.chat > 0 && <span className="ml-xs rounded-pill bg-accent-fill px-xs text-caption text-on-accent">{c.chat} new</span>}
          </span>
          <span className="block text-caption text-ink-secondary">Channels and direct messages for your team. Type @ to mention someone.</span>
        </span>
        <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
      </Link>
      <Link to="/business/tasks" className={card}>
        <ListChecks size={22} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Tasks</span>
          <span className="block text-caption text-ink-secondary">
            {!c
              ? 'Your team’s to-do list.'
              : c.open === 0
                ? 'Nothing assigned to you.'
                : `${c.open} open for you${c.due ? `, ${c.due} due today or overdue` : ''}.`}
          </span>
        </span>
        <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
      </Link>
    </>
  )
}

function OrgHome({ org }: { org: Org }) {
  const { crm, failed, reload } = useCrm(org.id)
  const personal = org.kind === 'personal'
  return (
    <>
      {failed && !crm ? (
        <LoadFailed what="your leads" onRetry={reload} />
      ) : !crm ? (
        <div aria-busy className="flex flex-col gap-sm">
          <p role="status" className="sr-only">
            Loading your leads.
          </p>
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      ) : (
        <>
          <FollowUps crm={crm} />
          <LeadsCard crm={crm} />
        </>
      )}

      {!personal && <TeamCards org={org} />}

      {org.role !== 'guest' && (
        <Link to="/business/performance" className={card}>
          <BarChart3 size={22} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Performance</span>
            <span className="block text-caption text-ink-secondary">Visits and inquiries per listing, and where they came from.</span>
          </span>
          <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
        </Link>
      )}

      {!personal && (
        <Link to="/business/team" className={card}>
          <UsersRound size={22} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Team</span>
            <span className="block text-caption text-ink-secondary">
              {org.members === 1 ? 'Only you so far.' : `${org.members} people.`} {canManage(org.role) ? 'Invite people and set their roles.' : 'See who’s on the team.'}
            </span>
          </span>
          <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
        </Link>
      )}

      {!personal && org.role !== 'guest' && (
        <div className="flex flex-col gap-xs rounded-lg border border-hairline bg-surface p-md sm:p-lg">
          <p className="font-semibold">Post a listing for {org.name}</p>
          <p className="text-caption text-ink-secondary">
            Pick {org.name} under “Post as” in the listing form. Buyers see the business name{org.prc_license ? ' and its PRC license' : ''} on the listing.
          </p>
          <ButtonLink to="/listings/new" variant="secondary" className="self-start" icon={<Plus size={18} aria-hidden />}>
            Post a listing
          </ButtonLink>
        </div>
      )}
    </>
  )
}

/** /business: leads and follow-ups for the account you picked, and where to go from here */
export function BusinessPage() {
  const user = useUser()
  const { pathname } = useLocation()
  const { orgs, failed, reload } = useMyOrgs({ personal: true })
  const org = useCurrentOrg(orgs)
  const hasBusiness = orgs?.some((o) => o.kind !== 'personal')

  if (!user) return <SignInFor from={pathname} title="Sign in to see your leads" />

  return (
    <div className="gutter mx-auto flex max-w-reading flex-col gap-lg py-xxl sm:py-section">
      {failed && !orgs ? (
        <LoadFailed what="your business accounts" onRetry={reload} />
      ) : !org || !orgs ? (
        <div aria-busy className="flex flex-col gap-sm">
          <p role="status" className="sr-only">
            Loading your business account.
          </p>
          <Skeleton className="h-12 w-2/3" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      ) : (
        <>
          <header className="flex flex-col gap-md sm:flex-row sm:items-end sm:justify-between">
            <div className="flex min-w-0 flex-col gap-xxs">
              <h1 className="text-display-md">{orgTitle(org)}</h1>
              <p className="text-ink-secondary">{orgLine(org)}</p>
            </div>
            <OrgSwitcher orgs={orgs} current={org} />
          </header>
          <OrgHome key={org.id} org={org} />
          {!hasBusiness && (
            <div className="flex flex-col gap-xs rounded-lg border border-hairline bg-surface p-md sm:p-lg">
              <p className="inline-flex items-center gap-xs font-semibold">
                <Building2 size={20} strokeWidth={1.75} className="text-ink-secondary" aria-hidden />
                Work leads as a team
              </p>
              <p className="text-caption text-ink-secondary">
                A business account lets you post under your business name, invite agents, and share one pipeline.
              </p>
              <ButtonLink to="/business/new" variant="secondary" className="self-start" icon={<Plus size={18} aria-hidden />}>
                Create a business account
              </ButtonLink>
            </div>
          )}
        </>
      )}
    </div>
  )
}
