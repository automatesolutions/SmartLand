import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, Plus, UsersRound } from 'lucide-react'
import { useUser } from '../../lib/auth'
import { canManage, orgLine, useCurrentOrg, useMyOrgs } from '../../lib/business'
import { ButtonLink } from '../../components/Button'
import { Skeleton } from '../../components/States'
import { LoadFailed, NoOrgYet, OrgSwitcher, SignInFor } from './Shared'

/** /business: the business account you picked, and where to go from here */
export function BusinessPage() {
  const user = useUser()
  const { pathname } = useLocation()
  const { orgs, failed, reload } = useMyOrgs()
  const org = useCurrentOrg(orgs)

  if (!user) return <SignInFor from={pathname} title="Sign in to see your business account" />
  if (orgs && !org) return <NoOrgYet />

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
              <h1 className="text-display-md">{org.name}</h1>
              <p className="text-ink-secondary">{orgLine(org)}</p>
            </div>
            <OrgSwitcher orgs={orgs} current={org} />
          </header>

          <ul className="flex flex-col gap-sm">
            <li>
              <Link
                to="/business/team"
                className="press flex min-h-tap items-center gap-md rounded-lg border border-hairline bg-surface p-md hover:bg-surface-raised"
              >
                <UsersRound size={22} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">Team</span>
                  <span className="block text-caption text-ink-secondary">
                    {org.members === 1 ? 'Only you so far.' : `${org.members} people.`} {canManage(org.role) ? 'Invite people and set their roles.' : 'See who’s on the team.'}
                  </span>
                </span>
                <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
              </Link>
            </li>
          </ul>

          {org.role !== 'guest' && (
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
      )}
    </div>
  )
}
