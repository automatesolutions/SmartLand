import { useEffect, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Check, ChevronLeft, Copy, LoaderCircle, UserRound } from 'lucide-react'
import { ApiError, businessApi, errorCopy, type Invite, type InviteRole, type Member, type Org } from '../../lib/api'
import { useUser } from '../../lib/auth'
import { ROLE_HINT, ROLE_LABEL, canManage, useCurrentOrg, useMyOrgs } from '../../lib/business'
import { formatDate } from '../../lib/format'
import { Button, ButtonLink } from '../../components/Button'
import { TextField } from '../../components/Fields'
import { Banner, Skeleton } from '../../components/States'
import { LoadFailed, NoOrgYet, OrgSwitcher, SignInFor } from './Shared'

const INVITE_ROLES: InviteRole[] = ['member', 'admin', 'guest']

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-xs">
      <input readOnly value={url} aria-label="Invite link" onFocus={(e) => e.target.select()} className="h-tap w-full rounded-sm border border-hairline bg-surface px-md text-caption text-ink" />
      <Button
        variant="secondary"
        className="self-start"
        icon={copied ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}
        onClick={() => {
          navigator.clipboard?.writeText(url).then(() => setCopied(true), () => setCopied(false))
        }}
      >
        {copied ? 'Copied' : 'Copy link'}
      </Button>
    </div>
  )
}

function InviteForm({ org, onInvited }: { org: Org; onInvited: () => void }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InviteRole>('member')
  const [error, setError] = useState<string | undefined>()
  const [failure, setFailure] = useState<string | null>(null)
  const [sent, setSent] = useState<{ email: string; url: string } | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError('Enter an email address, like name@example.com.')
      return
    }
    setBusy(true)
    setFailure(null)
    try {
      const made = await businessApi.invite(org.id, email.trim(), role)
      setSent({ email: made.email, url: `${window.location.origin}${made.path}` })
      setEmail('')
      onInvited()
    } catch (err) {
      setFailure(err instanceof ApiError && err.detail && (err.kind === 'conflict' || err.kind === 'invalid') ? err.detail : errorCopy(err).body)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="invite-heading" className="flex flex-col gap-md rounded-lg border border-hairline bg-surface p-md sm:p-lg">
      <h2 id="invite-heading" className="text-tagline font-semibold">
        Invite someone
      </h2>
      <form onSubmit={onSubmit} noValidate aria-busy={busy} className="flex flex-col gap-md">
        <TextField
          label="Email"
          hint="They join with the account that uses this email."
          type="email"
          inputMode="email"
          autoComplete="off"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setError(undefined)
          }}
          error={error}
          required
        />
        <fieldset className="flex flex-col gap-xs">
          <legend className="pb-xs font-semibold">Role</legend>
          {INVITE_ROLES.map((r) => (
            <label key={r} className="flex min-h-tap cursor-pointer items-start gap-sm">
              <input type="radio" name="invite-role" value={r} checked={role === r} onChange={() => setRole(r)} className="mt-1 size-5 shrink-0 accent-accent-fill" />
              <span className="flex flex-col">
                <span className="font-semibold">{ROLE_LABEL[r]}</span>
                <span className="text-caption text-ink-secondary">{ROLE_HINT[r]}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {failure && <Banner tone="critical" title="We couldn't make the invite">{failure}</Banner>}
        <Button type="submit" disabled={busy} className="self-start" icon={busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : undefined}>
          {busy ? 'Making invite link' : 'Make invite link'}
        </Button>
      </form>
      {sent && (
        <Banner tone="positive" title={`Invite link for ${sent.email}`} onDismiss={() => setSent(null)}>
          <div className="flex flex-col gap-sm">
            <p>Send this link to them yourself. It works once, only for {sent.email}, and expires in 7 days. You won’t see it again.</p>
            <CopyLink url={sent.url} />
          </div>
        </Banner>
      )}
    </section>
  )
}

function MemberRow({
  member,
  org,
  me,
  onChanged,
}: {
  member: Member
  org: Org
  me: string
  onChanged: (left: boolean) => void
}) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const self = member.id === me
  // The owner never changes. Admins can't change other admins.
  const editable = canManage(org.role) && member.role !== 'owner' && !(org.role === 'admin' && member.role === 'admin' && !self)
  const canLeave = self && member.role !== 'owner'

  async function act(fn: () => Promise<unknown>, left = false) {
    setBusy(true)
    setFailure(null)
    try {
      await fn()
      onChanged(left)
    } catch (err) {
      setFailure(err instanceof ApiError && err.detail ? err.detail : errorCopy(err).body)
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }

  return (
    <li className="flex flex-col gap-xs border-b border-hairline py-sm last:border-b-0">
      <div className="flex flex-wrap items-center gap-sm">
        <UserRound size={20} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">
            {member.name || member.email}
            {self && <span className="font-regular text-ink-secondary"> (you)</span>}
          </span>
          {member.name && <span className="block truncate text-caption text-ink-secondary">{member.email}</span>}
        </span>
        {editable && !self ? (
          <select
            aria-label={`Role for ${member.name || member.email}`}
            value={member.role}
            disabled={busy}
            onChange={(e) => void act(() => businessApi.setRole(org.id, member.id, e.target.value as InviteRole))}
            className="h-tap rounded-sm border border-hairline bg-surface px-sm text-ink focus-visible:border-focus"
          >
            {INVITE_ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-caption text-ink-secondary">{ROLE_LABEL[member.role]}</span>
        )}
      </div>
      {(editable || canLeave) &&
        (confirm ? (
          <div role="group" aria-label="Confirm" className="flex flex-wrap items-center gap-sm">
            <span className="text-caption">{self ? `Leave ${org.name}?` : `Remove ${member.name || member.email} from ${org.name}?`}</span>
            <Button variant="plain" onClick={() => setConfirm(false)}>
              Keep
            </Button>
            <Button variant="secondary" className="border-critical text-critical" disabled={busy} onClick={() => void act(() => businessApi.removeMember(org.id, member.id), self)}>
              {self ? 'Leave' : 'Remove'}
            </Button>
          </div>
        ) : (
          <Button variant="plain" className="-ml-xs self-start text-critical" onClick={() => setConfirm(true)}>
            {self ? 'Leave this business account' : 'Remove from team'}
          </Button>
        ))}
      {failure && <p className="text-caption text-critical">{failure}</p>}
    </li>
  )
}

function PendingInvites({ org, invites, onChanged }: { org: Org; invites: Invite[]; onChanged: () => void }) {
  const [failed, setFailed] = useState(false)
  if (!invites.length) return null
  return (
    <section aria-labelledby="pending-heading" className="flex flex-col gap-xs rounded-lg border border-hairline bg-surface p-md sm:p-lg">
      <h2 id="pending-heading" className="text-tagline font-semibold">
        Waiting to join
      </h2>
      <ul>
        {invites.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-sm border-b border-hairline py-xs last:border-b-0">
            <span className="min-w-0 flex-1">
              <span className="block truncate">{i.email}</span>
              <span className="block text-caption text-ink-secondary">
                {ROLE_LABEL[i.role]} · Link expires {formatDate(i.expires_at)}
              </span>
            </span>
            <Button
              variant="plain"
              onClick={() => {
                setFailed(false)
                businessApi.cancelInvite(org.id, i.id).then(onChanged, () => setFailed(true))
              }}
            >
              Cancel invite
            </Button>
          </li>
        ))}
      </ul>
      {failed && <p className="text-caption text-critical">That didn't go through. Check your connection, then try again.</p>}
    </section>
  )
}

export function TeamPage() {
  const user = useUser()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { orgs, failed: orgsFailed, reload: reloadOrgs } = useMyOrgs()
  const org = useCurrentOrg(orgs)
  const [team, setTeam] = useState<{ orgId: string; members: Member[]; invites: Invite[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!org) return
    const controller = new AbortController()
    businessApi
      .members(org.id, controller.signal)
      .then((t) => setTeam({ orgId: org.id, ...t }))
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') setFailed(true)
      })
    return () => controller.abort()
  }, [org, attempt])

  if (!user) return <SignInFor from={pathname} title="Sign in to see your team" />
  if (orgs && !org) return <NoOrgYet />

  const current = team && org && team.orgId === org.id ? team : null
  const refresh = () => {
    setFailed(false)
    setAttempt((n) => n + 1)
  }

  return (
    <div className="gutter mx-auto flex max-w-reading flex-col gap-lg py-xxl sm:py-section">
      <ButtonLink to="/business" variant="plain" className="-ml-xs self-start" icon={<ChevronLeft size={20} aria-hidden />}>
        Business account
      </ButtonLink>
      {orgsFailed && !orgs ? (
        <LoadFailed what="your business accounts" onRetry={reloadOrgs} />
      ) : !org || !orgs ? (
        <Skeleton className="h-12 w-2/3" />
      ) : (
        <>
          <header className="flex flex-col gap-md sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-xxs">
              <h1 className="text-display-md">Team</h1>
              <p className="text-ink-secondary">
                {org.name}. {canManage(org.role) ? 'Owners and admins manage the team.' : 'Owners and admins manage the team. Ask one of them to change roles.'}
              </p>
            </div>
            <OrgSwitcher orgs={orgs} current={org} />
          </header>

          {failed && !current ? (
            <LoadFailed what="the team" onRetry={refresh} />
          ) : !current ? (
            <div aria-hidden className="flex flex-col gap-sm">
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          ) : (
            <>
              <section aria-label="People on the team" className="rounded-lg border border-hairline bg-surface px-md sm:px-lg">
                <ul>
                  {current.members.map((m) => (
                    <MemberRow
                      key={m.id}
                      member={m}
                      org={org}
                      me={user.id}
                      onChanged={(left) => (left ? (reloadOrgs(), navigate('/business')) : refresh())}
                    />
                  ))}
                </ul>
              </section>
              {canManage(org.role) && (
                <>
                  <PendingInvites org={org} invites={current.invites} onChanged={refresh} />
                  <InviteForm org={org} onInvited={refresh} />
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
