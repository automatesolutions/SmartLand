import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { performanceApi, type Org, type Performance, type PerformanceDays } from '../../lib/api'
import { useUser } from '../../lib/auth'
import { orgTitle, useCurrentOrg, useMyOrgs } from '../../lib/business'
import { sourceLabel } from '../../lib/utm'
import { ShareLinks } from '../../components/ShareLinks'
import { Skeleton } from '../../components/States'
import { LoadFailed, OrgSwitcher, SignInFor } from './Shared'

const PERIODS: PerformanceDays[] = [7, 30, 90]

/** "3 of 120" as a share, or a dash before there are visits */
function rate(inquiries: number, visits: number): string {
  if (!visits) return '–'
  const pct = (inquiries / visits) * 100
  return `${pct < 10 && pct > 0 ? pct.toFixed(1) : Math.round(pct)}%`
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-xxs rounded-lg border border-hairline bg-surface p-md">
      <span className="text-caption text-ink-secondary">{label}</span>
      <span className="text-display-md tabular-nums">{value}</span>
    </div>
  )
}

const th = 'py-xs text-left font-semibold'
const num = 'py-xs pl-md text-right tabular-nums'

function Sources({ perf }: { perf: Performance }) {
  return (
    <section aria-labelledby="sources-heading" className="flex flex-col gap-sm">
      <h2 id="sources-heading" className="text-tagline font-semibold">
        Where people came from
      </h2>
      {perf.sources.length === 0 ? (
        <p className="text-ink-secondary">No visits yet. Post a share link from one of your listings, and visits show here by source.</p>
      ) : (
        <table className="w-full text-body">
          <thead className="border-b border-hairline text-caption text-ink-secondary">
            <tr>
              <th scope="col" className={th}>
                Source
              </th>
              <th scope="col" className={`${num} font-semibold`}>
                Visits
              </th>
              <th scope="col" className={`${num} font-semibold`}>
                Inquiries
              </th>
              <th scope="col" className={`${num} font-semibold`}>
                Rate
              </th>
            </tr>
          </thead>
          <tbody>
            {perf.sources.map((s) => (
              <tr key={s.source} className="border-b border-hairline">
                <th scope="row" className="py-xs text-left font-regular">
                  {sourceLabel(s.source)}
                </th>
                <td className={num}>{s.visits}</td>
                <td className={num}>{s.inquiries}</td>
                <td className={num}>{rate(s.inquiries, s.visits)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function ListingRow({ row }: { row: Performance['listings'][number] }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="flex flex-col gap-sm border-b border-hairline py-sm">
      <div className="flex flex-wrap items-center gap-x-md gap-y-xs">
        <Link to={`/listing/${row.id}`} className="min-w-0 flex-1 basis-48 font-semibold text-accent">
          {row.title}
          {row.status === 'sold' && <span className="ml-xs text-caption font-regular text-ink-secondary">Sold</span>}
        </Link>
        <span className="text-caption text-ink-secondary tabular-nums">
          {row.visits} {row.visits === 1 ? 'visit' : 'visits'} · {row.inquiries} {row.inquiries === 1 ? 'inquiry' : 'inquiries'} ·{' '}
          {rate(row.inquiries, row.visits)}
        </span>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="press -mr-xs inline-flex min-h-tap items-center gap-xxs px-xs text-accent"
        >
          Share links
          {open ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
        </button>
      </div>
      {open && <ShareLinks listingId={row.id} title={row.title} />}
    </li>
  )
}

function OrgPerformance({ org, orgs }: { org: Org; orgs: Org[] }) {
  const [days, setDays] = useState<PerformanceDays>(30)
  const [perf, setPerf] = useState<{ key: string; data: Performance } | null>(null)
  const [failed, setFailed] = useState(false)
  const key = `${org.id}:${days}`

  const load = useCallback(() => {
    const controller = new AbortController()
    performanceApi
      .load(org.id, days, controller.signal)
      .then((data) => {
        setFailed(false)
        setPerf({ key: `${org.id}:${days}`, data })
      })
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') setFailed(true)
      })
    return () => controller.abort()
  }, [org.id, days])

  useEffect(load, [load])
  const p = perf?.key === key ? perf.data : null

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex flex-col gap-md sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-xxs">
          <h1 className="text-display-md">Performance</h1>
          <p className="text-ink-secondary">{orgTitle(org)}</p>
        </div>
        <OrgSwitcher orgs={orgs} current={org} />
      </header>

      {org.role === 'guest' ? (
        <p className="text-ink-secondary">Owners, admins, and members see performance. Ask an owner or admin to change your role.</p>
      ) : (
        <>
          <div role="group" aria-label="Period" className="inline-flex self-start rounded-pill border border-hairline p-xxs">
            {PERIODS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={days === d}
                onClick={() => setDays(d)}
                className={`press inline-flex min-h-tap items-center rounded-pill px-md ${days === d ? 'bg-surface-raised font-semibold' : 'text-ink-secondary'}`}
              >
                {d} days
              </button>
            ))}
          </div>

          {failed && !p ? (
            <LoadFailed what="your performance" onRetry={load} />
          ) : !p ? (
            <div aria-busy className="flex flex-col gap-sm">
              <p role="status" className="sr-only">
                Loading your performance.
              </p>
              <Skeleton className="h-24 w-full rounded-lg" />
              <Skeleton className="h-48 w-full rounded-lg" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-sm xs:grid-cols-3">
                <Stat label="Visits" value={p.totals.visits} />
                <Stat label="Inquiries" value={p.totals.inquiries} />
                <Stat label="Visits that asked" value={rate(p.totals.inquiries, p.totals.visits)} />
              </div>

              <Sources perf={p} />

              <section aria-labelledby="listings-heading" className="flex flex-col gap-sm">
                <h2 id="listings-heading" className="text-tagline font-semibold">
                  Listings
                </h2>
                {p.listings.length === 0 ? (
                  <p className="text-ink-secondary">
                    No listings yet.{' '}
                    <Link to="/listings/new" className="text-accent">
                      Post a listing
                    </Link>{' '}
                    and its visits show here.
                  </p>
                ) : (
                  <ul className="flex flex-col">
                    {p.listings.map((row) => (
                      <ListingRow key={row.id} row={row} />
                    ))}
                  </ul>
                )}
              </section>

              <p className="text-caption text-ink-secondary">
                A visit is someone opening a listing, counted once per browser session. Visits from you and your team don’t count. We keep
                daily totals only, with nothing that identifies a visitor.
              </p>
            </>
          )}
        </>
      )}
    </div>
  )
}

/** /business/performance: visits and inquiries per listing and source */
export function PerformancePage() {
  const user = useUser()
  const { pathname } = useLocation()
  const { orgs, failed, reload } = useMyOrgs({ personal: true })
  const org = useCurrentOrg(orgs)

  if (!user) return <SignInFor from={pathname} title="Sign in to see how your listings do" />

  return (
    <div className="gutter mx-auto flex max-w-reading flex-col gap-lg py-xxl sm:py-section">
      {failed && !orgs ? (
        <LoadFailed what="your business accounts" onRetry={reload} />
      ) : !org || !orgs ? (
        <div aria-busy className="flex flex-col gap-sm">
          <p role="status" className="sr-only">
            Loading your business account.
          </p>
          <Skeleton className="h-12 w-1/3" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      ) : (
        <OrgPerformance key={org.id} org={org} orgs={orgs} />
      )}
    </div>
  )
}
