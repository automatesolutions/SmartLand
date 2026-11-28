import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  BarChart3,
  Building2,
  CalendarClock,
  ChevronRight,
  Headphones,
  ImageOff,
  Inbox,
  ListChecks,
  MessagesSquare,
  Plus,
  Share2,
  UsersRound,
  Video,
} from 'lucide-react'
import { performanceApi, workspaceApi, type Crm, type Org, type Performance } from '../../lib/api'
import { useUser } from '../../lib/auth'
import { canManage, dueLeads, followUpLabel, orgLine, orgTitle, today, useCrm, useCurrentOrg, useMyOrgs } from '../../lib/business'
import { useListingSchema } from '../../lib/listings'
import { Button, ButtonLink } from '../../components/Button'
import { Skeleton } from '../../components/States'
import { LoadFailed, OrgSwitcher, SignInFor } from './Shared'

const row = 'press flex min-h-tap items-center gap-md rounded-lg border border-hairline bg-surface p-md hover:bg-surface-raised'
const badge = 'ml-xs rounded-pill bg-accent-fill px-xs text-caption font-regular text-on-accent'
const icon = { size: 22, strokeWidth: 1.75, className: 'shrink-0 text-ink-secondary', 'aria-hidden': true } as const

type TeamCounts = { orgId: string; chat: number; due: number; open: number }

/** New team messages and your open tasks. Null while loading, or if it fails: the tiles still link through. */
function useTeamCounts(org: Org): TeamCounts | null {
  const [counts, setCounts] = useState<TeamCounts | null>(null)
  const skip = org.kind === 'personal'
  useEffect(() => {
    if (skip) return
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
        // Counts are extra; the tiles work without them
      })
    return () => controller.abort()
  }, [org.id, skip])
  return counts?.orgId === org.id ? counts : null
}

/** Visits over the last 7 days and the account's listings. Guests can't see performance. */
function useWeek(org: Org): { perf: Performance | null; failed: boolean } {
  const [state, setState] = useState<{ orgId: string; perf: Performance | null; failed: boolean } | null>(null)
  const skip = org.role === 'guest'
  useEffect(() => {
    if (skip) return
    const controller = new AbortController()
    performanceApi
      .load(org.id, 7, controller.signal)
      .then((perf) => setState({ orgId: org.id, perf, failed: false }))
      .catch((err) => {
        if (!controller.signal.aborted) setState({ orgId: org.id, perf: null, failed: !!err })
      })
    return () => controller.abort()
  }, [org.id, skip])
  return state?.orgId === org.id ? state : { perf: null, failed: false }
}

/** One number at the top of the page. Shows a placeholder while it loads. */
function Stat({ label, value, to, alert }: { label: string; value: number | null; to: string; alert?: boolean }) {
  return (
    <Link to={to} className="press flex flex-col gap-xxs rounded-lg border border-hairline bg-surface p-md hover:bg-surface-raised">
      {value === null ? (
        <Skeleton className="h-9 w-12" />
      ) : (
        <span className={`text-display-sm tabular-nums ${alert && value > 0 ? 'text-accent' : ''}`}>{value.toLocaleString()}</span>
      )}
      <span className="text-caption text-ink-secondary">{label}</span>
    </Link>
  )
}

function Tile({ to, glyph, title, extra, children }: { to?: string; glyph: ReactNode; title: string; extra?: ReactNode; children: ReactNode }) {
  const body = (
    <>
      {glyph}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">
          {title}
          {extra}
        </span>
        <span className="block text-caption text-ink-secondary">{children}</span>
      </span>
      {to && <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />}
    </>
  )
  return to ? (
    <Link to={to} className={`${row} h-full`}>
      {body}
    </Link>
  ) : (
    <div className="flex h-full min-h-tap items-center gap-md rounded-lg border border-dashed border-hairline p-md">{body}</div>
  )
}

function FollowUps({ crm }: { crm: Crm }) {
  const due = dueLeads(crm.leads)
  const t = today()
  if (due.length === 0) return null
  return (
    <section aria-labelledby="due-heading" className="flex flex-col gap-sm">
      <h2 id="due-heading" className="text-tagline font-semibold">
        Follow up today
      </h2>
      <ul className="flex flex-col gap-xs">
        {due.map((l) => (
          <li key={l.id}>
            <Link to={`/business/leads/${l.id}`} className={row}>
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
    </section>
  )
}

/** The account's listings with visits and videos, and a way to add a video to each */
function YourListings({ org, perf, failed, videoOn, maxVideos }: { org: Org; perf: Performance | null; failed: boolean; videoOn: boolean; maxVideos: number }) {
  const personal = org.kind === 'personal'
  return (
    <section id="your-listings" aria-labelledby="listings-heading" className="flex scroll-mt-[7rem] flex-col gap-sm">
      <div className="flex items-end justify-between gap-md">
        <h2 id="listings-heading" className="text-tagline font-semibold">
          Your listings
        </h2>
        {perf && perf.listings.length > 0 && (
          <Link to="/business/performance" className="text-caption text-accent">
            See performance
          </Link>
        )}
      </div>
      {failed ? (
        <p className="text-ink-secondary">We couldn’t load your listings. Reload the page to try again.</p>
      ) : !perf ? (
        <div aria-busy className="flex flex-col gap-xs">
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      ) : perf.listings.length === 0 ? (
        <div className="flex flex-col gap-xs rounded-lg border border-hairline bg-surface p-md sm:p-lg">
          <p className="font-semibold">{personal ? 'You haven’t posted a listing yet' : `No listings for ${org.name} yet`}</p>
          <p className="text-caption text-ink-secondary">
            {personal
              ? 'Post a property with photos and a walkthrough video. Buyers who message you show up under Leads.'
              : `When you post, pick ${org.name} under “Post as”. Buyers see the business name${org.prc_license ? ' and its PRC license' : ''} on the listing.`}
          </p>
          <ButtonLink to="/listings/new" variant="secondary" className="self-start" icon={<Plus size={18} aria-hidden />}>
            Post a listing
          </ButtonLink>
        </div>
      ) : (
        <ul className="flex flex-col gap-xs">
          {perf.listings.map((l) => (
            <li key={l.id} className="flex items-center gap-md rounded-lg border border-hairline bg-surface p-sm">
              <Link to={`/listing/${l.id}`} className="press flex min-w-0 flex-1 items-center gap-md">
                {l.cover_url ? (
                  <img src={l.cover_url} alt="" loading="lazy" className="size-14 shrink-0 rounded-sm object-cover" />
                ) : (
                  <span className="flex size-14 shrink-0 items-center justify-center rounded-sm bg-surface-raised">
                    <ImageOff size={20} strokeWidth={1.75} className="text-ink-secondary" aria-hidden />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{l.title}</span>
                  <span className="block truncate text-caption text-ink-secondary">
                    {l.status === 'sold' ? 'Sold · ' : ''}
                    {l.visits} {l.visits === 1 ? 'visit' : 'visits'} this week · {l.videos} {l.videos === 1 ? 'video' : 'videos'}
                  </span>
                </span>
              </Link>
              {videoOn && l.status !== 'sold' && l.videos < maxVideos && (
                <Link
                  to={`/listing/${l.id}#add-video`}
                  className="press inline-flex min-h-tap shrink-0 items-center gap-xxs rounded-pill px-xs text-caption text-accent"
                  aria-label={`Add a video to ${l.title}`}
                >
                  <Video size={18} strokeWidth={1.75} aria-hidden />
                  <span className="hidden sm:inline">Add video</span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function OrgHome({ org }: { org: Org }) {
  const { crm, failed, reload } = useCrm(org.id)
  const team = useTeamCounts(org)
  const week = useWeek(org)
  const schema = useListingSchema()
  const personal = org.kind === 'personal'
  const guest = org.role === 'guest'
  const videoOn = !!schema?.video?.enabled

  const open = crm ? crm.leads.filter((l) => !l.closed_at) : []
  const leadUnread = crm ? crm.leads.reduce((n, l) => n + l.unread, 0) : 0
  const due = crm ? dueLeads(crm.leads).length : null
  const stageLine = crm
    ? crm.stages
        .filter((s) => !s.outcome)
        .map((s) => `${s.name} ${open.filter((l) => l.stage_id === s.id).length}`)
        .join(' · ')
    : ''
  // Lead messages, plus team chat when there's a team. Wait for both before showing a number.
  const messages = !crm ? null : personal ? leadUnread : team ? leadUnread + team.chat : null

  return (
    <>
      {failed && !crm ? (
        <LoadFailed what="your leads" onRetry={reload} />
      ) : (
        <section aria-label="This week at a glance" className="grid grid-cols-2 gap-sm sm:grid-cols-4">
          <Stat label="New messages" value={messages} to={personal ? '/business/leads' : '/business/workspace'} alert />
          <Stat label="Open leads" value={crm ? open.length : null} to="/business/leads" />
          <Stat label="Follow-ups due" value={due} to="/business/leads" alert />
          {guest ? (
            <Stat label="Your open tasks" value={team ? team.open : null} to="/business/tasks" />
          ) : (
            <Stat label="Visits, last 7 days" value={week.perf ? week.perf.totals.visits : week.failed ? 0 : null} to="/business/performance" />
          )}
        </section>
      )}

      {!guest && (
        <div className="flex flex-wrap gap-xs">
          <ButtonLink to="/listings/new" icon={<Plus size={18} aria-hidden />}>
            Post a listing
          </ButtonLink>
          {videoOn && (
            <Button
              variant="secondary"
              icon={<Video size={18} aria-hidden />}
              onClick={() => document.getElementById('your-listings')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              Add a video
            </Button>
          )}
          <ButtonLink to="/business/performance" variant="secondary" icon={<Share2 size={18} aria-hidden />}>
            Share a listing
          </ButtonLink>
        </div>
      )}

      {crm && <FollowUps crm={crm} />}

      <section aria-label="Your workspace" className="grid gap-sm sm:grid-cols-2">
        <Tile
          to="/business/leads"
          glyph={<Inbox {...icon} />}
          title="Leads"
          extra={leadUnread > 0 && <span className={badge}>{leadUnread} new</span>}
        >
          {!crm ? 'Buyers who message you about a listing.' : open.length === 0 ? 'No open leads yet. Buyers who message you show up here.' : stageLine}
        </Tile>
        {!personal && (
          <Tile
            to="/business/workspace"
            glyph={<MessagesSquare {...icon} />}
            title="Team chat"
            extra={team && team.chat > 0 && <span className={badge}>{team.chat} new</span>}
          >
            Channels and direct messages. Type @ to mention someone.
          </Tile>
        )}
        {!personal && (
          <Tile to="/business/tasks" glyph={<ListChecks {...icon} />} title="Tasks">
            {!team ? 'Your team’s to-do list.' : team.open === 0 ? 'Nothing assigned to you.' : `${team.open} open for you${team.due ? `, ${team.due} due` : ''}.`}
          </Tile>
        )}
        {!guest && (
          <Tile to="/business/performance" glyph={<BarChart3 {...icon} />} title="Performance">
            {week.perf
              ? `${week.perf.totals.visits} ${week.perf.totals.visits === 1 ? 'visit' : 'visits'} and ${week.perf.totals.inquiries} ${week.perf.totals.inquiries === 1 ? 'inquiry' : 'inquiries'} this week.`
              : 'Visits and inquiries per listing, and where they came from.'}
          </Tile>
        )}
        {!personal && (
          <Tile to="/business/team" glyph={<UsersRound {...icon} />} title="Team">
            {org.members === 1 ? 'Only you so far.' : `${org.members} people.`} {canManage(org.role) ? 'Invite people and set their roles.' : 'See who’s on the team.'}
          </Tile>
        )}
        {!personal && (
          <Tile
            glyph={<Headphones {...icon} />}
            title="Huddles"
            extra={<span className="ml-xs rounded-pill border border-hairline px-xs text-caption font-regular text-ink-secondary">Coming soon</span>}
          >
            Voice and video calls with your team, and live tours for buyers.
          </Tile>
        )}
      </section>

      {!guest && <YourListings org={org} perf={week.perf} failed={week.failed} videoOn={videoOn} maxVideos={schema?.video?.max_per_listing ?? 3} />}
    </>
  )
}

/** /business: today's numbers, the workspace, and your listings for the account you picked */
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
          <div className="grid grid-cols-2 gap-sm sm:grid-cols-4">
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
            <Skeleton className="h-24 rounded-lg" />
          </div>
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
