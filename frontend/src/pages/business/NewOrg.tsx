import { useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'
import { ApiError, businessApi, errorCopy, type OrgKind } from '../../lib/api'
import { KIND_LABEL, pickOrg } from '../../lib/business'
import { useUser } from '../../lib/auth'
import { Button } from '../../components/Button'
import { TextField } from '../../components/Fields'
import { Banner } from '../../components/States'
import { SignInFor } from './Shared'

export function NewOrgPage() {
  const user = useUser()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<OrgKind>('brokerage')
  const [license, setLicense] = useState('')
  const [errors, setErrors] = useState<{ name?: string; license?: string }>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!user) return <SignInFor from={pathname} title="Sign in to create a business account" />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const found: typeof errors = {}
    if (name.trim().length < 2) found.name = 'Enter the business name.'
    if (kind === 'brokerage' && !/^\d{4,10}$/.test(license.trim())) found.license = 'Enter the broker’s PRC license number, digits only.'
    setErrors(found)
    if (Object.keys(found).length) {
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      return
    }
    setBusy(true)
    setFailure(null)
    try {
      const org = await businessApi.create({ name: name.trim(), kind, prc_license: kind === 'brokerage' ? license.trim() : null })
      pickOrg(org.id)
      navigate('/business')
    } catch (err) {
      setFailure(err instanceof ApiError && err.kind === 'invalid' && err.detail ? err.detail : errorCopy(err).body)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-canvas-alt">
      <div className="gutter mx-auto flex max-w-form flex-col gap-xl py-xxl sm:py-section">
        <header className="flex flex-col gap-sm">
          <h1 className="text-display-md sm:text-display-lg">Create a business account</h1>
          <p className="text-ink-secondary">
            Post listings under your business name, invite your team, and work your leads together. Your own listings stay yours.
          </p>
        </header>
        <form onSubmit={onSubmit} noValidate aria-busy={busy} className="flex flex-col gap-lg rounded-lg border border-hairline bg-surface p-md sm:p-lg">
          <TextField
            label="Business name"
            hint="Buyers see it on every listing you post for this business."
            value={name}
            maxLength={80}
            autoComplete="organization"
            onChange={(e) => {
              setName(e.target.value)
              if (errors.name) setErrors((x) => ({ ...x, name: undefined }))
            }}
            error={errors.name}
            required
          />
          <fieldset className="flex flex-col gap-xs">
            <legend className="pb-xs font-semibold">What kind of business</legend>
            <div className="flex flex-wrap gap-xs">
              {(Object.keys(KIND_LABEL) as OrgKind[]).map((k) => (
                <label
                  key={k}
                  className={`press inline-flex min-h-tap cursor-pointer items-center rounded-pill bg-surface px-md text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus ${kind === k ? 'border-2 border-focus font-semibold' : 'border border-hairline'}`}
                >
                  <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
                  {KIND_LABEL[k]}
                </label>
              ))}
            </div>
          </fieldset>
          {kind === 'brokerage' && (
            <TextField
              label="Broker’s PRC license number"
              hint="Buyers see it on your listings and can look it up on the PRC website."
              inputMode="numeric"
              value={license}
              onChange={(e) => {
                setLicense(e.target.value)
                if (errors.license) setErrors((x) => ({ ...x, license: undefined }))
              }}
              error={errors.license}
              required
            />
          )}
          {failure && <Banner tone="critical" title="We couldn't create your business account">{failure}</Banner>}
          <Button
            type="submit"
            size="large"
            disabled={busy}
            className="w-full sm:w-auto sm:self-start"
            icon={busy ? <LoaderCircle size={20} className="animate-spin" aria-hidden /> : undefined}
          >
            {busy ? 'Creating business account' : 'Create business account'}
          </Button>
          <p className="text-caption text-ink-secondary">You’ll be the owner. You can invite your team next.</p>
        </form>
      </div>
    </div>
  )
}
