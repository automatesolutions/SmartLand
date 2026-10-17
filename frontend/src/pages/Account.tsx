import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { LoaderCircle, LogOut, RotateCcw, UserRound } from 'lucide-react'
import { ApiError } from '../lib/api'
import { signIn, signOut, useUser } from '../lib/auth'
import { retrySync, useSavedReports, useSyncState } from '../lib/reports'
import { useReveal } from '../lib/motion'
import { Button, ButtonLink } from '../components/Button'
import { TextField } from '../components/Fields'
import { Banner } from '../components/States'

type Mode = 'login' | 'register'

const SYNC_COPY = {
  local: '',
  syncing: 'Syncing your reports.',
  synced: 'Your reports are up to date on this device.',
  error: "We couldn't reach your account. Reports you save here will upload later.",
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
      <div className="flex flex-col gap-sm xs:flex-row">
        <ButtonLink to="/reports">Open saved reports</ButtonLink>
        <Button variant="plain" onClick={signOut} icon={<LogOut size={18} aria-hidden />}>
          Sign out
        </Button>
      </div>
      <p className="text-caption text-ink-secondary">
        When you sign out, your reports stay in your account and leave this device.
      </p>
    </div>
  )
}

export function AccountPage() {
  const user = useUser()
  const navigate = useNavigate()
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)
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
      navigate('/reports')
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
        )}
      </div>
    </div>
  )
}
