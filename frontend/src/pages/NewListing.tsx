import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, FileCheck2, FileUp, LoaderCircle, Lock, MapPin, UserRound, X } from 'lucide-react'
import {
  ApiError,
  errorCopy,
  listingsApi,
  type DetailValue,
  type DocumentType,
  type FieldSpec,
  type ListingInput,
  type ListingSchema,
  type Place,
  type SellerType,
} from '../lib/api'
import { useUser } from '../lib/auth'
import { useGoogleAvailable } from '../lib/google'
import { CATEGORIES, SELLER_LABEL, categoryBySlug, readNear, useListingSchema, type CategorySpec } from '../lib/listings'
import { Button, ButtonLink } from '../components/Button'
import { TextArea, TextField } from '../components/Fields'
import { PinMapView } from '../components/Map'
import { Banner, EmptyState, Skeleton } from '../components/States'
import { GoogleSignIn } from '../components/GoogleSignIn'

const control =
  'h-tap w-full rounded-sm border border-hairline bg-surface px-md text-body text-ink transition-colors duration-200 ease-apple focus-visible:border-focus aria-[invalid=true]:border-critical'

// Documents in the order sellers usually have them
const DOC_ORDER: DocumentType[] = ['title', 'rights', 'tax_declaration', 'tax_clearance', 'survey_plan', 'other']

function placeLabel(place: Place): string {
  const parts = [place.barangay, place.locality, place.province].filter((p, i, all): p is string => !!p && all.indexOf(p) === i)
  return parts.length > 0 ? parts.join(', ') : place.display_name.split(',').slice(0, 3).join(',').trim()
}

const num = (s: string) => (s.trim() === '' ? null : Number(s.replace(/,/g, '')))
const formatMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-md rounded-lg border border-hairline bg-surface p-md sm:p-lg">
      <div className="flex flex-col gap-xxs">
        <h2 className="text-tagline font-semibold">{title}</h2>
        {hint && <p className="text-caption text-ink-secondary">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function SignInFirst() {
  const { pathname, search } = useLocation()
  const google = useGoogleAvailable()
  return (
    <div className="gutter mx-auto flex max-w-form flex-col gap-lg py-xxl sm:py-section">
      <h1 className="text-display-md">Post a listing</h1>
      <div className="flex flex-col gap-md rounded-lg border border-hairline bg-surface p-md sm:p-lg">
        <UserRound size={28} strokeWidth={1.75} className="text-ink-secondary" aria-hidden />
        <p className="text-tagline font-semibold">Sign in to post</p>
        <p className="text-ink-secondary">Every listing belongs to an account, so you can change the price, add documents, or mark it sold later.</p>
        {google !== false && <GoogleSignIn oneTap />}
        {google === false ? (
          <ButtonLink to="/account" state={{ from: pathname + search }} className="self-start">
            Sign in or create an account
          </ButtonLink>
        ) : (
          <ButtonLink to="/account" state={{ from: pathname + search }} variant="plain" className="-ml-xs self-start">
            Use your email instead
          </ButtonLink>
        )}
      </div>
    </div>
  )
}

/** /listings/new: pick what you're posting */
export function NewListingPickerPage() {
  const [params] = useSearchParams()
  const user = useUser()
  if (!user) return <SignInFirst />
  const qs = params.toString()
  return (
    <div className="gutter mx-auto flex max-w-reading flex-col gap-lg py-xxl sm:py-section">
      <header className="flex flex-col gap-xs">
        <h1 className="text-display-md">What are you posting?</h1>
        <p className="text-ink-secondary">
          Each kind asks for what buyers and renters need to know. Properties with documents behind them get a higher credibility score.
        </p>
      </header>
      <ul className="grid gap-sm sm:grid-cols-2">
        {CATEGORIES.map((c) => (
          <li key={c.key} className="flex">
            <Link
              to={`/listings/new/${c.slug}${qs ? `?${qs}` : ''}`}
              className="press flex w-full items-center gap-md rounded-lg border border-hairline bg-surface p-md transition-colors hover:bg-surface-raised"
            >
              <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-pill bg-surface-raised text-ink">
                <c.icon size={22} strokeWidth={1.75} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{c.label}</span>
                <span className="text-caption text-ink-secondary">{c.blurb}</span>
              </span>
              <ChevronRight size={18} className="shrink-0 text-ink-secondary" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** /listings/new/:slug: the form for one kind of property */
export function NewListingPage() {
  const { slug = '' } = useParams()
  const user = useUser()
  const schema = useListingSchema()
  const category = categoryBySlug(slug)
  if (!user) return <SignInFirst />
  if (!category) {
    return (
      <EmptyState
        as="h1"
        icon={FileCheck2}
        title="We don't list this kind of property"
        body="Pick one of the kinds we support."
        action={<ButtonLink to="/listings/new">See the kinds</ButtonLink>}
      />
    )
  }
  if (!schema) {
    return (
      <div aria-busy className="gutter mx-auto flex max-w-form flex-col gap-md py-xxl">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-96 w-full rounded-lg" />
      </div>
    )
  }
  return <ListingForm key={category.key} category={category} schema={schema} />
}

function DetailInput({
  field,
  value,
  error,
  onChange,
}: {
  field: FieldSpec
  value: string | boolean | undefined
  error?: string
  onChange: (v: string | boolean | undefined) => void
}) {
  const id = `f-${field.key}`
  const label = `${field.label}${field.unit ? ` (${field.unit})` : ''}${field.required ? '' : ' (optional)'}`
  if (field.type === 'bool') {
    return (
      <fieldset className="flex flex-col gap-xs">
        <legend className="pb-xs font-semibold">{label}</legend>
        <div className="flex gap-xs">
          {[
            ['Yes', true],
            ['No', false],
          ].map(([text, v]) => (
            <label
              key={String(v)}
              className={`press inline-flex min-h-tap cursor-pointer items-center rounded-pill bg-surface px-md text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus ${value === v ? 'border-2 border-focus font-semibold' : 'border border-hairline'}`}
            >
              <input type="radio" name={id} checked={value === v} onChange={() => onChange(v as boolean)} className="sr-only" />
              {text as string}
            </label>
          ))}
        </div>
      </fieldset>
    )
  }
  return (
    <div className="flex flex-col gap-xs">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      {field.hint && <p className="text-caption text-ink-secondary">{field.hint}</p>}
      {field.type === 'select' ? (
        <select id={id} value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)} aria-invalid={!!error} className={control}>
          <option value="">{field.required ? 'Choose one' : 'Not sure or not applicable'}</option>
          {field.options?.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={field.type === 'date' ? 'date' : 'text'}
          inputMode={field.type === 'number' ? 'decimal' : undefined}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          className={control}
        />
      )}
      {error && <p className="text-caption text-critical">{error}</p>}
    </div>
  )
}

function ListingForm({ category, schema }: { category: CategorySpec; schema: ListingSchema }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const near = readNear(params)
  const spec = schema.categories[category.key]
  const fields = spec.fields
  const [title, setTitle] = useState('')
  const [price, setPrice] = useState('')
  const [details, setDetails] = useState<Record<string, string | boolean | undefined>>({})
  const [description, setDescription] = useState('')
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null)
  const [place, setPlace] = useState('')
  const [area, setArea] = useState<{
    town: string | null
    province: string | null
  }>({ town: null, province: null })
  const [naming, setNaming] = useState(false)
  const [seller, setSeller] = useState<SellerType>(category.key === 'foreclosure' ? 'bank' : 'owner')
  const [license, setLicense] = useState('')
  const [contactName, setContactName] = useState('')
  const [phone, setPhone] = useState('')
  const [authorized, setAuthorized] = useState(false)
  const [staged, setStaged] = useState<Partial<Record<DocumentType, File>>>({})
  const [errors, setErrors] = useState<Record<string, string | undefined>>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const nameAbort = useRef<AbortController | null>(null)
  const fileInputs = useRef<Partial<Record<DocumentType, HTMLInputElement | null>>>({})

  async function onPin(lat: number, lon: number) {
    setPin({ lat, lon })
    setErrors((e) => ({ ...e, pin: undefined }))
    nameAbort.current?.abort()
    const controller = new AbortController()
    nameAbort.current = controller
    setNaming(true)
    try {
      const found = await listingsApi.reverse(lat, lon, controller.signal)
      setPlace(placeLabel(found))
      setArea({
        town: found.locality ?? null,
        province: found.province ?? null,
      })
      setErrors((e) => ({ ...e, place: undefined }))
    } catch {
      // The pin still counts; the seller types the place instead
    } finally {
      if (nameAbort.current === controller) setNaming(false)
    }
  }

  /** Sets a field and clears its error, so a fixed field stops showing one */
  function edit(key: string, set: (v: string) => void, v: string) {
    set(v)
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  function setDetail(key: string, v: string | boolean | undefined) {
    setDetails((d) => ({ ...d, [key]: v }))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  function stage(type: DocumentType, file: File | undefined) {
    if (file && file.size > schema.max_document_mb * 1024 * 1024) {
      setErrors((e) => ({
        ...e,
        [`doc-${type}`]: `This file is ${formatMb(file.size)}. Files can be up to ${schema.max_document_mb} MB.`,
      }))
      return
    }
    setErrors((e) => ({ ...e, [`doc-${type}`]: undefined }))
    setStaged((s) => ({ ...s, [type]: file }))
  }

  /** Field values as the API wants them, plus any errors */
  function collect(): {
    values: Record<string, DetailValue>
    lot: number | null
    floor: number | null
    errs: Record<string, string>
  } {
    const values: Record<string, DetailValue> = {}
    const errs: Record<string, string> = {}
    let lot: number | null = null
    let floor: number | null = null
    for (const f of fields) {
      const raw = details[f.key]
      if (raw === undefined || raw === '') {
        if (f.required) errs[f.key] = `Enter the ${f.label.toLowerCase()}.`
        continue
      }
      if (f.type === 'number') {
        const n = num(String(raw))
        if (n === null || !Number.isFinite(n)) errs[f.key] = `${f.label} must be a number.`
        else if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max))
          errs[f.key] = `Enter a number from ${f.min ?? 0} to ${f.max ?? 'any'}.`
        else if (f.key === 'lot_sqm') lot = n
        else if (f.key === 'floor_sqm') floor = n
        else values[f.key] = n
      } else {
        values[f.key] = raw
      }
    }
    return { values, lot, floor, errs }
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault()
    const { values, lot, floor, errs } = collect()
    if (title.trim().length < 5) errs.title = 'Enter a title of at least 5 characters.'
    const p = num(price)
    if (p === null || !Number.isFinite(p) || p <= 0) errs.price = spec.rent ? 'Enter the monthly rent in pesos.' : 'Enter the asking price in pesos.'
    if (!pin) errs.pin = 'Put the pin on the property.'
    if (place.trim().length < 2) errs.place = 'Enter the barangay and town.'
    if (seller === 'broker' && !/^\d{4,10}$/.test(license.trim())) errs.prc_license = 'Enter your PRC license number, digits only.'
    if (contactName.trim().length < 2) errs.contact_name = 'Enter the name people should ask for.'
    if (!/^[0-9+()\-\s]{7,20}$/.test(phone.trim())) errs.contact_phone = 'Enter a phone number, such as 0917 123 4567.'
    if (!authorized) errs.authorized = `Confirm that you may ${spec.rent ? 'rent out' : 'sell'} this property.`
    setErrors(errs)
    if (Object.keys(errs).length > 0) {
      requestAnimationFrame(() => document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus())
      if (errs.pin) document.getElementById('where')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    const input: ListingInput = {
      category: category.key,
      title: title.trim(),
      description: description.trim(),
      price: Math.round(p!),
      lot_sqm: lot,
      floor_sqm: floor,
      lat: pin!.lat,
      lon: pin!.lon,
      place: place.trim(),
      town: area.town,
      province: area.province,
      seller_type: seller,
      prc_license: seller === 'broker' ? license.trim() : null,
      contact_name: contactName.trim(),
      contact_phone: phone.trim(),
      details: values,
      authorized,
    }
    setFailure(null)
    setProgress('Posting your listing')
    try {
      const listing = await listingsApi.create(input)
      const docs = DOC_ORDER.filter((t) => staged[t])
      let failed = 0
      for (const [i, t] of docs.entries()) {
        setProgress(`Uploading document ${i + 1} of ${docs.length}`)
        try {
          await listingsApi.uploadDocument(listing.id, t, staged[t]!)
        } catch {
          failed += 1
        }
      }
      navigate(`/listing/${listing.id}`, {
        replace: true,
        state: { posted: true, uploadFailed: failed },
      })
    } catch (err) {
      setFailure(err instanceof ApiError && err.kind === 'invalid' && err.detail ? err.detail : errorCopy(err).body)
      setProgress(null)
    }
  }

  const busy = progress !== null
  const qs = params.toString()
  const fieldError = (k: string) => errors[k]

  return (
    <form onSubmit={onSubmit} noValidate className="gutter mx-auto flex max-w-form flex-col gap-lg py-xxl sm:py-section">
      <header className="flex flex-col gap-xs">
        <Link to={`/listings/new${qs ? `?${qs}` : ''}`} className="press -ml-xs inline-flex min-h-tap items-center gap-xxs self-start px-xs text-accent">
          <ChevronLeft size={20} aria-hidden />
          Change what you’re posting
        </Link>
        <p className="inline-flex items-center gap-xs text-caption text-ink-secondary">
          <category.icon size={16} aria-hidden />
          {category.label}
        </p>
        <h1 className="text-display-md">Post {category.one}</h1>
      </header>

      <Section title="The property">
        <TextField
          label="Title"
          hint="What a buyer should know first, such as “1-hectare coconut farm by the national highway”."
          value={title}
          maxLength={120}
          onChange={(e) => edit('title', setTitle, e.target.value)}
          error={fieldError('title')}
        />
        <TextField
          label={spec.rent ? 'Monthly rent (₱)' : 'Asking price (₱)'}
          hint={spec.rent ? undefined : 'The full price. It’s shown publicly, and every change to it stays on the listing’s record.'}
          inputMode="numeric"
          placeholder={spec.rent ? '15,000' : '2,500,000'}
          value={price}
          onChange={(e) => edit('price', setPrice, e.target.value)}
          error={fieldError('price')}
        />
        <div className="grid gap-md sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.key} className={f.type === 'bool' || f.hint ? 'sm:col-span-2' : ''}>
              <DetailInput field={f} value={details[f.key]} error={fieldError(f.key)} onChange={(v) => setDetail(f.key, v)} />
            </div>
          ))}
        </div>
        <TextArea
          label="Description (optional)"
          hint="Anything the fields above don’t cover: what’s included, nearby landmarks, or the history of the property."
          value={description}
          maxLength={4000}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Section>

      <div id="where">
        <Section title="Where it is" hint="Click the map where the property is. Drag the pin to fine-tune it.">
          <PinMapView point={pin} center={near ?? undefined} onPick={(lat, lon) => void onPin(lat, lon)} className="h-80 rounded-lg border border-hairline" />
          {errors.pin && (
            <p role="alert" className="text-caption text-critical">
              {errors.pin}
            </p>
          )}
          {pin && (
            <p className="inline-flex items-center gap-xxs text-caption tabular-nums text-ink-secondary">
              {naming ? <LoaderCircle size={14} className="animate-spin" aria-hidden /> : <MapPin size={14} aria-hidden />}
              {naming ? 'Finding the barangay and town' : `Pinned at ${pin.lat.toFixed(5)}, ${pin.lon.toFixed(5)}`}
            </p>
          )}
          <TextField
            label="Barangay and town"
            hint="Filled in from the pin. Add a street or landmark if it helps."
            value={place}
            maxLength={200}
            onChange={(e) => edit('place', setPlace, e.target.value)}
            error={fieldError('place')}
          />
        </Section>
      </div>

      <Section
        title={spec.rent ? 'Documents (optional)' : 'Documents'}
        hint={
          <>
            Documents raise the listing’s credibility score, and a SmartLand reviewer checks each one with the office that issued it. Checked documents count
            the most.{' '}
            <span className="inline-flex items-center gap-xxs font-semibold text-ink">
              <Lock size={12} aria-hidden />
              Only you and our reviewers can open the files.
            </span>{' '}
            Buyers see which documents you added, whether we checked them, and each file’s fingerprint.
          </>
        }
      >
        <ul className="flex flex-col">
          {DOC_ORDER.map((t) => {
            const d = schema.documents[t]
            const pts = schema.scoring[t]
            const file = staged[t]
            return (
              <li key={t} className="flex flex-col gap-xs border-b border-hairline py-sm first:pt-0 last:border-b-0 last:pb-0">
                <div className="flex items-start justify-between gap-sm">
                  <span className="flex min-w-0 flex-col">
                    <span className="font-semibold">{d.label}</span>
                    <span className="text-caption text-ink-secondary">{d.hint}</span>
                    {pts && (
                      <span className="text-caption tabular-nums text-ink-secondary">
                        +{pts.uploaded} points now, {pts.verified} once checked
                      </span>
                    )}
                  </span>
                  <input
                    ref={(el) => {
                      fileInputs.current[t] = el
                    }}
                    type="file"
                    accept={schema.document_types.join(',')}
                    onChange={(e) => {
                      stage(t, e.target.files?.[0])
                      e.target.value = ''
                    }}
                    className="sr-only"
                    tabIndex={-1}
                    aria-label={`Choose a file for ${d.label}`}
                  />
                  {!file && (
                    <Button variant="secondary" className="shrink-0" onClick={() => fileInputs.current[t]?.click()} icon={<FileUp size={18} aria-hidden />}>
                      Add
                    </Button>
                  )}
                </div>
                {file && (
                  <p className="flex items-center justify-between gap-sm rounded-md bg-surface-raised px-sm text-caption">
                    <span className="inline-flex min-w-0 items-center gap-xxs">
                      <FileCheck2 size={16} className="shrink-0 text-positive" aria-hidden />
                      <span className="truncate">{file.name}</span>
                      <span className="shrink-0 tabular-nums text-ink-secondary">· {formatMb(file.size)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => stage(t, undefined)}
                      className="press inline-flex size-tap shrink-0 items-center justify-center text-ink-secondary"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X size={18} aria-hidden />
                    </button>
                  </p>
                )}
                {errors[`doc-${t}`] && <p className="text-caption text-critical">{errors[`doc-${t}`]}</p>}
              </li>
            )
          })}
        </ul>
        <p className="text-caption text-ink-secondary">
          PDF, JPG, PNG, or WebP, up to {schema.max_document_mb} MB each. Upload clear photos or scans of the whole page. You can add documents later too.
        </p>
      </Section>

      <Section title={spec.rent ? 'Who’s renting it out' : 'Who’s selling'}>
        <fieldset className="flex flex-col gap-xs">
          <legend className="pb-xs font-semibold">You are the</legend>
          <div className="flex flex-wrap gap-xs">
            {(Object.keys(SELLER_LABEL) as SellerType[]).map((s) => (
              <label
                key={s}
                className={`press inline-flex min-h-tap cursor-pointer items-center rounded-pill bg-surface px-md text-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus ${seller === s ? 'border-2 border-focus font-semibold' : 'border border-hairline'}`}
              >
                <input type="radio" name="seller" value={s} checked={seller === s} onChange={() => setSeller(s)} className="sr-only" />
                {SELLER_LABEL[s]}
              </label>
            ))}
          </div>
        </fieldset>
        {seller === 'broker' && (
          <TextField
            label="PRC license number"
            hint="Buyers can look it up on the PRC website. Only licensed brokers may sell for someone else."
            inputMode="numeric"
            value={license}
            onChange={(e) => edit('prc_license', setLicense, e.target.value)}
            error={fieldError('prc_license')}
          />
        )}
        <TextField
          label="Contact name"
          autoComplete="name"
          value={contactName}
          maxLength={80}
          onChange={(e) => edit('contact_name', setContactName, e.target.value)}
          error={fieldError('contact_name')}
        />
        <TextField
          label="Phone number"
          hint="Shown on the listing page to anyone who opens it."
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => edit('contact_phone', setPhone, e.target.value)}
          error={fieldError('contact_phone')}
        />
        <label className="flex cursor-pointer items-start gap-sm">
          <input
            type="checkbox"
            checked={authorized}
            onChange={(e) => {
              setAuthorized(e.target.checked)
              setErrors((x) => ({ ...x, authorized: undefined }))
            }}
            aria-invalid={!!errors.authorized}
            className="mt-1 size-5 shrink-0 accent-accent-fill"
          />
          <span className="flex flex-col">
            <span>
              I own this property, or I’m authorized by the owner to {spec.rent ? 'rent it out' : 'sell it'}. The documents I add are real and unaltered.
            </span>
            {errors.authorized && <span className="text-caption text-critical">{errors.authorized}</span>}
          </span>
        </label>
      </Section>

      {failure && (
        <Banner tone="critical" title="We couldn't post your listing">
          {failure}
        </Banner>
      )}

      <div className="flex flex-col items-stretch gap-xs sm:flex-row sm:items-center sm:justify-end">
        {progress && (
          <p role="status" className="text-caption text-ink-secondary">
            {progress}.
          </p>
        )}
        <Button type="submit" size="large" disabled={busy} icon={busy ? <LoaderCircle size={20} className="animate-spin" aria-hidden /> : undefined}>
          {busy ? 'Posting' : 'Post listing'}
        </Button>
      </div>
    </form>
  )
}
