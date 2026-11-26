import { useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Briefcase, ChevronRight, LoaderCircle, LogOut, Mail, Plus, RotateCcw, UserRound } from 'lucide-react'
import { ApiError } from '../lib/api'
import { signIn, signOut, useUser } from '../lib/auth'
import { retrySync, useSavedReports, useSyncState } from '../lib/reports'
import { useReveal } from '../lib/motion'
import { Button, ButtonLink } from '../components/Button'
import { TextField } from '../components/Fields'
import { Banner } from '../components/States'
import { InstallAppButton } from '../components/InstallAppButton'
import { GoogleSignIn } from '../components/GoogleSignIn'
import { useGoogleAvailable } from '../lib/google'
import { orgLine, pickOrg, useMyOrgs } from '../lib/business'
import { SUPPORT_EMAIL } from '../lib/support'

type Mode = 'login' | 'register'

function MadeBy() {
  return (
    <section aria-label="About SmartLand" className="flex flex-col gap-sm">
      <div className="flex items-center gap-md rounded-lg border border-hairline bg-surface p-md">
        <img
          src="/brand/bezalel.webp"
          alt="NG-BEZALEL STAINLESS CRAFTERS logo"
          width={64}
          height={62}
          className="shrink-0 rounded-md bg-[#141414]"
        />
        <div className="min-w-0">
          <p>
            Made by <strong className="font-semibold">ZALEL LABS</strong>. We build software, cybersecurity, and AI products.
          </p>
          <p className="mt-xs text-caption text-ink-secondary">ZALEL LABS is part of NG-BEZALEL STAINLESS CRAFTERS.</p>
        </div>
      </div>
      <a
        href={`mailto:${SUPPORT_EMAIL}?subject=SmartLand%20support`}
        className="press flex min-h-tap items-center gap-md rounded-lg border border-hairline bg-surface p-md hover:bg-surface-raised"
      >
        <Mail size={20} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Get help</span>
          <span className="block truncate text-caption text-ink-secondary">Email {SUPPORT_EMAIL}</span>
        </span>
        <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
      </a>
    </section>
  )
}

const SYNC_COPY = {
  local: '',
  syncing: 'Syncing your reports.',
  synced: 'Your reports are up to date on this device.',
  error: "We couldn't reach your account. Reports you save here will upload later.",
}

/** Your business accounts, and a way to make one */
function BusinessAccounts() {
  const { orgs, failed, reload } = useMyOrgs()
  return (
    <section aria-labelledby="business-heading" className="flex flex-col gap-sm border-t border-hairline pt-md">
      <div className="flex flex-col gap-xxs">
        <h2 id="business-heading" className="font-semibold">
          Business
        </h2>
        <p className="text-caption text-ink-secondary">For brokerages, developers, and agencies: post listings under your business name and work leads as a team.</p>
      </div>
      {failed && !orgs ? (
        <p className="text-caption text-ink-secondary">
          We couldn't load your business accounts.{' '}
          <button type="button" onClick={reload} className="press text-accent">
            Try again
          </button>
        </p>
      ) : (
        orgs &&
        orgs.length > 0 && (
          <ul className="flex flex-col gap-xs">
            {orgs.map((o) => (
              <li key={o.id}>
                <Link
                  to="/business"
                  onClick={() => pickOrg(o.id)}
                  className="press flex min-h-tap items-center gap-md rounded-lg border border-hairline bg-surface p-md hover:bg-surface-raised"
                >
                  <Briefcase size={20} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{o.name}</span>
                    <span className="block truncate text-caption text-ink-secondary">{orgLine(o)}</span>
                  </span>
                  <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )
      )}
      <ButtonLink to="/business/new" variant="secondary" className="self-start" icon={<Plus size={18} aria-hidden />}>
        Create a business account
      </ButtonLink>
    </section>
  )
}

function SignedIn() {
  const user = useUser()!
  const reports = useSavedReports()
  const sync = useSyncState()
  return (
    <div className="flex flex-col gap-lg rounded-lg border border-hairline bg-surface p-md sm:p-lg">
      <div className="flex items-center gap-md">
        <span className="inline-flex size-tap shrink-0 items-center justify-center rounded-pill bg-surface-raised text-ink-secondary">
          <UserRound size={22} strokeWidth={1.75} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{user.name || user.email}</p>
          {user.name && <p className="truncate text-caption text-ink-secondary">{user.email}</p>}
        </div>
      </div>
      <p className="text-ink-secondary" role="status">
        {reports.length} saved {reports.length === 1 ? 'report' : 'reports'}. {SYNC_COPY[sync]}
      </p>
      {sync === 'error' && (
        <Button variant="secondary" className="self-start" onClick={retrySync} icon={<RotateCcw size={18} aria-hidden />}>
          Try syncing again
        </Button>
      )}
      <div className="flex flex-col gap-sm xs:flex-row xs:flex-wrap">
        <ButtonLink to="/reports">Open saved reports</ButtonLink>
        <ButtonLink to="/listings/mine" variant="secondary">
          Your listings
        </ButtonLink>
        {user.is_admin && (
          <ButtonLink to="/reviews" variant="secondary">
            Review documents
          </ButtonLink>
        )}
      </div>
      <BusinessAccounts />
      <div className="flex flex-col items-start gap-xs border-t border-hairline pt-md">
        <Button variant="plain" className="-ml-sm" onClick={signOut} icon={<LogOut size={18} aria-hidden />}>
          Sign out
        </Button>
        <p className="text-caption text-ink-secondary">
          When you sign out, your reports stay in your account and leave this device.
        </p>
      </div>
    </div>
  )
}

export function AccountPage() {
  const user = useUser()
  const navigate = useNavigate()
  // Pages that need an account (such as posting a listing) send people here and get them back
  const from = (useLocation().state as { from?: string } | null)?.from
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)
  const googleAvailable = useGoogleAvailable()
  useReveal(pageRef, [Boolean(user)])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const found: typeof errors = {}
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) found.email = 'Enter an email address, like name@example.com.'
    if (password.length < 8) found.password = 'Use at least 8 characters.'
    setErrors(found)
    if (Object.keys(found).length) {
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      return
    }
    setBusy(true)
    setFailure(null)
    try {
      await signIn(mode, email, password, mode === 'register' ? name : undefined)
      navigate(from ?? '/reports')
    } catch (err) {
      const kind = err instanceof ApiError ? err.kind : 'server'
      setFailure(
        kind === 'unauthorized'
          ? 'Wrong email or password. Check them, then try again.'
          : kind === 'conflict'
            ? 'An account with this email already exists. Sign in instead.'
            : kind === 'rate-limited'
              ? 'Too many tries. Wait a few minutes, then try again.'
              : kind === 'offline'
                ? "We couldn't reach SmartLand. Check that the backend is running, then try again."
                : 'Something went wrong on our side. Try again in a moment.',
      )
    } finally {
      setBusy(false)
    }
  }

  function switchMode(next: Mode) {
    setMode(next)
    setFailure(null)
    setErrors({})
  }

  return (
    <div ref={pageRef} className="bg-canvas-alt">
      <div className="gutter mx-auto flex max-w-form flex-col gap-xl py-xxl sm:py-section">
        <header data-reveal className="flex flex-col gap-sm">
          <h1 className="text-display-md sm:text-display-lg">{user ? 'Your account' : mode === 'login' ? 'Sign in' : 'Create an account'}</h1>
          {!user && (
            <p className="text-ink-secondary">
              An account keeps your saved reports on every device and lets you share them with a link. You can check
              locations without one.
            </p>
          )}
        </header>

        {user ? (
          <SignedIn />
        ) : (
          <>
            {googleAvailable !== false && (
              <>
                <section data-reveal aria-label="Sign in with Google" className="flex flex-col gap-sm rounded-lg border border-hairline bg-surface p-md sm:p-lg">
                  <GoogleSignIn oneTap onSignedIn={() => navigate(from ?? '/reports')} />
                  <p className="text-caption text-ink-secondary">
                    Use your Gmail or any Google account. We get your name and email, nothing else. If you already have a SmartLand account with the same email,
                    it signs you into that one.
                  </p>
                </section>
                <p
                  data-reveal
                  className="flex items-center gap-sm text-caption text-ink-secondary before:h-px before:flex-1 before:bg-hairline after:h-px after:flex-1 after:bg-hairline"
                >
                  or use your email
                </p>
              </>
            )}
          <form
            onSubmit={onSubmit}
            noValidate
            data-reveal
            aria-busy={busy}
            className="flex flex-col gap-lg rounded-lg border border-hairline bg-surface p-md sm:p-lg"
          >
            <div role="group" aria-label="Choose" className="flex gap-xs">
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  onClick={() => switchMode(m)}
                  className={`press min-h-tap rounded-pill border px-md text-caption ${
                    mode === m ? 'border-2 border-focus font-semibold' : 'border-hairline bg-surface'
                  }`}
                >
                  {m === 'login' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>

            {mode === 'register' && (
              <TextField label="Name" hint="Optional." name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            )}
            <TextField
              label="Email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (errors.email) setErrors((x) => ({ ...x, email: undefined }))
              }}
              error={errors.email}
              required
            />
            <TextField
              label="Password"
              hint={mode === 'register' ? 'At least 8 characters.' : undefined}
              name="password"
              type="password"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (errors.password) setErrors((x) => ({ ...x, password: undefined }))
              }}
              error={errors.password}
              required
            />

            {failure && <Banner tone="critical" title={mode === 'login' ? "We couldn't sign you in" : "We couldn't create your account"}>{failure}</Banner>}

            <Button
              type="submit"
              size="large"
              disabled={busy}
              className="w-full sm:w-auto sm:self-start"
              icon={busy ? <LoaderCircle size={20} className="animate-spin" aria-hidden /> : undefined}
            >
              {mode === 'login' ? (busy ? 'Signing in' : 'Sign in') : busy ? 'Creating account' : 'Create account'}
            </Button>
            {mode === 'register' && (
              <p className="text-caption text-ink-secondary">Reports already saved on this device move into your new account.</p>
            )}
          </form>
          </>
        )}

        <InstallAppButton variant="row" />
        <MadeBy />
      </div>
    </div>
  )
}
