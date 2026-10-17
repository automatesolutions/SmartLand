import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, LoaderCircle, MapPin, Newspaper, RotateCcw, Search } from 'lucide-react'
import { analyzeLocation, ApiError, errorCopy, locate, type AnalyzeInput, type LocateResult } from '../lib/api'
import { DEFAULT_DATA, FACTORS, PLACE_SUGGESTIONS, SOURCE_LABEL, type FactorKey } from '../lib/presets'
import { newReportId, storeDraft } from '../lib/reports'
import { Button } from '../components/Button'
import { RangeField, TextArea, TextField } from '../components/Fields'
import { Banner, Skeleton } from '../components/States'
import { MapView } from '../components/Map'
import { useReveal } from '../lib/motion'

type Errors = Partial<Record<FactorKey | 'location', string>>

interface Lookup {
  query: string
  result: LocateResult
}

function validate(input: AnalyzeInput): Errors {
  const errors: Errors = {}
  if (input.location.trim().length < 2) errors.location = 'Enter a city, town, or barangay.'
  for (const f of FACTORS) {
    const v = input.data[f.key]
    if (Number.isNaN(v)) errors[f.key] = 'Enter a number.'
    else if (v < f.min || v > f.max) errors[f.key] = `Enter a number from ${f.min} to ${f.max}.`
  }
  return errors
}

/** Values from the lookup, except the ones the person changed */
function mergeFactors(data: AnalyzeInput['data'], lookup: LocateResult, touched: Set<FactorKey>): AnalyzeInput['data'] {
  const next = { ...data }
  for (const f of FACTORS) {
    if (!touched.has(f.key)) next[f.key] = lookup.factors[f.key]
  }
  return next
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const id = useId()
  return (
    <section
      role="group"
      aria-labelledby={id}
      data-reveal
      className="flex flex-col gap-lg rounded-lg border border-hairline bg-surface p-md sm:p-lg"
    >
      <div className="flex flex-col gap-xxs">
        <h2 id={id} className="text-tagline font-semibold">
          {title}
        </h2>
        {hint && <p className="text-caption text-ink-secondary">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function PlaceFound({ lookup }: { lookup: LocateResult }) {
  const { place, amenities, news } = lookup
  return (
    <div className="flex flex-col gap-md">
      <div className="flex items-start gap-sm">
        <MapPin size={20} strokeWidth={2} className="mt-0.5 shrink-0 text-positive" aria-hidden />
        <div className="flex min-w-0 flex-col gap-xxs">
          <p className="font-semibold">{place.display_name}</p>
          <p className="text-caption text-ink-secondary">
            {place.source === 'openstreetmap' ? 'Found on OpenStreetMap' : 'Matched from our list of reference areas'}
            {place.elevation_m != null && ` · ${Math.round(place.elevation_m)} m above sea level`}
          </p>
        </div>
      </div>
      <MapView lat={place.lat} lon={place.lon} label={place.name} amenities={amenities} />
      {news.articles.length > 0 && (
        <div className="flex flex-col gap-xs">
          <p className="flex items-center gap-xs font-semibold">
            <Newspaper size={18} strokeWidth={1.75} className="text-ink-secondary" aria-hidden />
            Recent news we found
          </p>
          <ul className="flex list-disc flex-col gap-xxs pl-lg text-caption text-ink-secondary">
            {news.articles.slice(0, 4).map((a) => (
              <li key={a.title}>
                {a.title}
                {a.source && <span className="text-ink-disabled"> · {a.source}</span>}
              </li>
            ))}
          </ul>
          <p className="text-caption text-ink-secondary">These headlines count toward the growth score.</p>
        </div>
      )}
    </div>
  )
}

export function CheckPage() {
  const navigate = useNavigate()
  const prefill = (useLocation().state as { input?: AnalyzeInput } | null)?.input
  const [location, setLocation] = useState(prefill?.location ?? '')
  const [data, setData] = useState<AnalyzeInput['data']>(prefill?.data ?? DEFAULT_DATA)
  // Coming back from a report keeps its values, so treat them all as the person's own
  const [touched, setTouched] = useState<Set<FactorKey>>(() => new Set(prefill ? FACTORS.map((f) => f.key) : []))
  const [lookup, setLookup] = useState<Lookup | null>(null)
  const [finding, setFinding] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [failure, setFailure] = useState<unknown>(null)
  const abortRef = useRef<AbortController | null>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  useReveal(pageRef)

  useEffect(() => () => abortRef.current?.abort(), [])

  const fresh = lookup !== null && lookup.query === location.trim()

  function setFactor(key: FactorKey, value: number) {
    setData((d) => ({ ...d, [key]: value }))
    setTouched((t) => new Set(t).add(key))
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  function resetToFound() {
    if (!lookup) return
    setTouched(new Set())
    setData((d) => mergeFactors(d, lookup.result, new Set()))
  }

  /** Looks the place up and fills the form. Returns the merged values, or null on failure. */
  async function findPlace(signal: AbortSignal): Promise<{ data: AnalyzeInput['data']; lookup: Lookup } | null> {
    const query = location.trim()
    if (query.length < 2) {
      setErrors((e) => ({ ...e, location: 'Enter a city, town, or barangay.' }))
      return null
    }
    setFinding(true)
    setFailure(null)
    setStatus('idle')
    try {
      const result = await locate(query, signal)
      const next = { query, result }
      const merged = mergeFactors(data, result, touched)
      setLookup(next)
      setData(merged)
      return { data: merged, lookup: next }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return null
      setFailure(err)
      setStatus('error')
      if (err instanceof ApiError && err.kind === 'not-found') {
        setErrors((e) => ({ ...e, location: "We couldn't find this place. Add the town or province." }))
      }
      return null
    } finally {
      setFinding(false)
    }
  }

  function newController() {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    return controller
  }

  async function onFind() {
    await findPlace(newController().signal)
  }

  async function run() {
    const controller = newController()
    let current = { data, lookup }
    if (!fresh) {
      // The location always drives the estimate, so look it up first
      const found = await findPlace(controller.signal)
      if (!found) return
      current = found
    }

    const input: AnalyzeInput = { location: location.trim(), data: current.data }
    const found = validate(input)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      // Move focus to the first field that needs fixing
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      return
    }

    const result = current.lookup?.result
    const headlines = result?.news.articles.map((a) => a.title).join('. ') ?? ''
    const sent: AnalyzeInput = { ...input, data: { ...input.data, news_text: input.data.news_text.trim() || headlines } }
    setStatus('loading')
    setFailure(null)
    try {
      const report = await analyzeLocation(
        sent,
        result && {
          place: result.place,
          amenities: result.amenities,
          news_articles: result.news.articles,
          measured: Object.values(result.sources).includes('openstreetmap'),
        },
        controller.signal,
      )
      const id = newReportId()
      storeDraft({ id, createdAt: new Date().toISOString(), input, result: report })
      navigate(`/reports/${id}`, { state: { fresh: true } })
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setFailure(err)
      setStatus('error')
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void run()
  }

  const loading = status === 'loading'
  const busy = loading || finding
  const copy = failure ? errorCopy(failure) : null
  const sourceNote = (key: FactorKey) => {
    if (touched.has(key)) return 'Changed by you'
    if (!fresh || !lookup) return undefined
    return SOURCE_LABEL[lookup.result.sources[key]]
  }

  function factorFields(group: 'area' | 'access') {
    return FACTORS.filter((f) => f.group === group).map((f) => (
      <RangeField
        key={f.key}
        label={f.label}
        hint={f.hint}
        note={sourceNote(f.key)}
        min={f.min}
        max={f.max}
        step={f.step}
        unit={f.unit}
        value={data[f.key]}
        onChange={(v) => setFactor(f.key, v)}
        error={errors[f.key]}
      />
    ))
  }

  return (
    <div ref={pageRef} className="bg-canvas-alt">
      <div className="gutter mx-auto flex max-w-form flex-col gap-xl py-xxl sm:py-section">
        <header data-reveal className="flex flex-col gap-sm">
          <h1 className="text-display-md sm:text-display-lg">Check a location</h1>
          <p className="text-ink-secondary">
            Enter a place in the Philippines. We fill in the details from map, regional, and news data. You can change
            any value you know better.
          </p>
        </header>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-lg" aria-busy={busy}>
          <Section title="Location">
            <TextField
              label="City, town, or barangay"
              name="location"
              search
              placeholder="For example, Sabang, Lipa, Batangas"
              autoComplete="address-level2"
              list="place-suggestions"
              value={location}
              onChange={(e) => {
                setLocation(e.target.value)
                if (errors.location) setErrors((x) => ({ ...x, location: undefined }))
              }}
              error={errors.location}
              required
            />
            <datalist id="place-suggestions">
              {PLACE_SUGGESTIONS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            {!fresh && (
              <Button
                variant="secondary"
                className="self-start"
                disabled={busy}
                onClick={() => void onFind()}
                icon={finding ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : <Search size={18} aria-hidden />}
              >
                {finding ? 'Finding this place' : 'Find this place'}
              </Button>
            )}
            {finding && (
              <div aria-hidden className="flex flex-col gap-sm">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-72 w-full" />
              </div>
            )}
            {fresh && lookup && !finding && <PlaceFound lookup={lookup.result} />}
          </Section>

          <Section
            title="The area"
            hint={fresh ? 'Filled in for this place. These shape the growth score the most.' : 'Find the place first to fill these in.'}
          >
            {factorFields('area')}
          </Section>

          <Section title="Getting around" hint="Closer amenities raise both price and growth.">
            {factorFields('access')}
            {fresh && touched.size > 0 && (
              <Button variant="plain" className="-ml-xs self-start" icon={<RotateCcw size={18} aria-hidden />} onClick={resetToFound}>
                Use the values we found
              </Button>
            )}
          </Section>

          <Section title="News you know about" hint="Optional. New roads, malls, or airports nearby can lift the grade.">
            <TextArea
              label="News about this area"
              hint="Paste a headline or a short paragraph. It replaces the headlines we found."
              placeholder="For example, DPWH starts work on a new bypass road through Lipa."
              value={data.news_text}
              maxLength={2000}
              onChange={(e) => setData((d) => ({ ...d, news_text: e.target.value }))}
            />
          </Section>

          {status === 'error' && copy && (
            <Banner
              tone="critical"
              title={copy.title}
              action={
                <Button variant="secondary" icon={<RotateCcw size={18} aria-hidden />} onClick={() => void run()}>
                  Try again
                </Button>
              }
            >
              {copy.body}
            </Banner>
          )}

          <div data-reveal className="flex flex-col gap-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-caption text-ink-secondary">Takes a few seconds. Nothing is saved until you choose to.</p>
            <Button
              type="submit"
              size="large"
              disabled={busy}
              className="w-full sm:w-auto"
              icon={loading ? <LoaderCircle size={20} className="animate-spin" aria-hidden /> : undefined}
              iconAfter={loading ? undefined : <ArrowRight size={20} aria-hidden />}
            >
              {loading ? 'Checking location' : 'Check this location'}
            </Button>
          </div>

          <p role="status" aria-live="polite" className="sr-only">
            {finding
              ? `Finding ${location.trim()}.`
              : loading
                ? `Checking ${location.trim()}. This takes a few seconds.`
                : fresh && lookup
                  ? `Found ${lookup.result.place.display_name}. The form is filled in.`
                  : ''}
          </p>

          {loading && (
            <div aria-hidden className="flex flex-col gap-md rounded-lg border border-hairline bg-surface p-lg">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-12 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
