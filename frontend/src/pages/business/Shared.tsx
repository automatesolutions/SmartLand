import { Building2, RotateCw, UserRound } from 'lucide-react'
import type { Org } from '../../lib/api'
import { pickOrg } from '../../lib/business'
import { Button, ButtonLink } from '../../components/Button'
import { EmptyState } from '../../components/States'

/** Shown on business pages when nobody is signed in */
export function SignInFor({ from, title }: { from: string; title: string }) {
  return (
    <EmptyState
      as="h1"
      icon={UserRound}
      title={title}
      body="Business accounts belong to the people on their team."
      action={
        <ButtonLink to="/account" state={{ from }}>
          Sign in
        </ButtonLink>
      }
    />
  )
}

export function NoOrgYet() {
  return (
    <EmptyState
      as="h1"
      icon={Building2}
      title="No business account yet"
      body="Create one to post listings under your business name and invite your team."
      action={<ButtonLink to="/business/new">Create a business account</ButtonLink>}
    />
  )
}

export function LoadFailed({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-sm rounded-lg border border-hairline bg-surface p-lg">
      <p className="font-semibold">We couldn't load {what}</p>
      <p className="text-ink-secondary">Check your connection, then try again.</p>
      <Button variant="secondary" onClick={onRetry} icon={<RotateCw size={18} aria-hidden />}>
        Try again
      </Button>
    </div>
  )
}

/** Picks which business account the business pages show, when you're on more than one */
export function OrgSwitcher({ orgs, current }: { orgs: Org[]; current: Org }) {
  if (orgs.length < 2) return null
  return (
    <div className="flex flex-col gap-xs">
      <label htmlFor="org-switcher" className="text-caption font-semibold">
        Business account
      </label>
      <select
        id="org-switcher"
        value={current.id}
        onChange={(e) => pickOrg(e.target.value)}
        className="h-tap rounded-sm border border-hairline bg-surface px-md text-ink focus-visible:border-focus"
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </div>
  )
}
