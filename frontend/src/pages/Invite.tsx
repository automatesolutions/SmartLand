import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { LoaderCircle, MailX, RotateCw } from 'lucide-react'
import { ApiError, businessApi, errorCopy, type InvitePreview } from '../lib/api'
import { signOut, useUser } from '../lib/auth'
import { ROLE_HINT, ROLE_LABEL, pickOrg } from '../lib/business'
import { formatDate } from '../lib/format'
import { Button, ButtonLink } from '../components/Button'
import { Banner, EmptyState, Skeleton } from '../components/States'

/** /invite/:token: join a business account from the link a teammate sent */
export function InvitePage() {
  const { token = '' } = useParams()
  const user = useUser()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [invite, setInvite] = useState<{ token: string; data: InvitePreview } | null>(null)
  const [failure, setFailure] = useState<{ token: string; err: unknown } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [joinFailure, setJoinFailure] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    businessApi
      .invitePreview(token, controller.signal)
      .then((data) => setInvite({ token, data }))
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') setFailure({ token, err })
      })
    return () => controller.abort()
  }, [token, attempt])

  const inv = invite?.token === token ? invite.data : null
  const err = failure?.token === token ? failure.err : null

  if (!inv && err) {
    const gone = err instanceof ApiError && err.kind === 'not-found'
    return (
      <EmptyState
        as="h1"
        icon={MailX}
        title={gone ? 'This invite doesn’t work anymore' : "We couldn't load this invite"}
        body={gone ? 'It was used, canceled, or expired. Ask the person who invited you for a new link.' : 'Check your connection, then try again.'}
        action={
          gone ? undefined : (
            <Button onClick={() => setAttempt((n) => n + 1)} icon={<RotateCw size={18} aria-hidden />}>
              Try again
            </Button>
          )
        }
      />
    )
  }

  if (!inv) {
    return (
      <div aria-busy className="gutter mx-auto flex max-w-form flex-col gap-md py-xxl">
        <p role="status" className="sr-only">
          Loading the invite.
        </p>
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  async function join() {
    setBusy(true)
    setJoinFailure(null)
    try {
      const { org_id } = await businessApi.acceptInvite(token)
      pickOrg(org_id)
      navigate('/business', { replace: true })
    } catch (e) {
      setJoinFailure(e instanceof ApiError && e.detail ? e.detail : errorCopy(e).body)
    } finally {
      setBusy(false)
    }
  }

  const wrongAccount = user && user.email.toLowerCase() !== inv.email

  return (
    <div className="bg-canvas-alt">
      <div className="gutter mx-auto flex max-w-form flex-col gap-xl py-xxl sm:py-section">
        <header className="flex flex-col gap-sm">
          <h1 className="text-display-md">Join {inv.org_name}</h1>
          <p className="text-ink-secondary">
            {inv.inviter} invited {inv.email} to join as {inv.role === 'admin' ? 'an' : 'a'} {ROLE_LABEL[inv.role].toLowerCase()}. {ROLE_HINT[inv.role]}.
          </p>
          <p className="text-caption text-ink-secondary">This link expires on {formatDate(inv.expires_at)}.</p>
        </header>
        <div className="flex flex-col gap-md rounded-lg border border-hairline bg-surface p-md sm:p-lg">
          {!user ? (
            <>
              <p>Sign in or create an account with {inv.email}, then come back to this link.</p>
              <ButtonLink to="/account" state={{ from: pathname }} className="self-start">
                Sign in
              </ButtonLink>
            </>
          ) : wrongAccount ? (
            <>
              <Banner tone="caution" title={`This invite is for ${inv.email}`}>
                You’re signed in as {user.email}. Sign out, then sign in with {inv.email}.
              </Banner>
              <Button variant="secondary" className="self-start" onClick={() => signOut()}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              {joinFailure && <Banner tone="critical" title="We couldn't add you to the team">{joinFailure}</Banner>}
              <Button
                size="large"
                className="self-start"
                disabled={busy}
                onClick={() => void join()}
                icon={busy ? <LoaderCircle size={20} className="animate-spin" aria-hidden /> : undefined}
              >
                {busy ? 'Joining' : `Join ${inv.org_name}`}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
