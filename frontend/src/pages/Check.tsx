import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  CircleAlert,
  CloudLightning,
  FileText,
  Hospital,
  LoaderCircle,
  LocateFixed,
  MapPin,
  MousePointerClick,
  Newspaper,
  RotateCcw,
  Route,
  School,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Store,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react'
import {
  analyzeLocation,
  ApiError,
  errorCopy,
  locate,
  locatePoint,
  type AnalyzeContext,
  type AnalyzeInput,
  type AnalyzeResult,
  type LocateResult,
  type Place,
} from '../lib/api'
import { DEFAULT_DATA, FACTORS, PLACE_SUGGESTIONS, SOURCE_LABEL, type FactorKey } from '../lib/presets'
import { newReportId, storeDraft } from '../lib/reports'
import { formatPeso, parseGrade } from '../lib/format'
import { Button } from '../components/Button'
import { CountUp } from '../components/CountUp'
import { RangeField, TextArea } from '../components/Fields'
import { GradeBadge } from '../components/Grade'
import { Banner, Skeleton } from '../components/States'
import { PinMapView } from '../components/Map'
import { useReveal } from '../lib/motion'

type Errors = Partial<Record<FactorKey | 'location', string>>

interface Lookup {
  query: string
  result: LocateResult
}

interface Point {
  lat: number
  lon: number
}

interface Preview {
  key: string
  input: AnalyzeInput
  result: AnalyzeResult
}

const FACTOR_ICONS: Record<FactorKey, LucideIcon> = {
  infrastructure_score: Route,
  typhoon_risk: CloudLightning,
  gdp_growth: TrendingUp,
  population_growth: Users,
  proximity_to_mall: ShoppingBag,
  proximity_to_school: School,
  proximity_to_hospital: Hospital,
  distance_to_amenities: Store,
}

// Same box the backend accepts
const inPhilippines = ({ lat, lon }: Point) => lat >= 4.2 && lat <= 21.5 && lon >= 116 && lon <= 127

const peso = (n: number) => formatPeso(Math.round(n))

/** Short name for a pinned spot, such as "Sabang, Lipa, Batangas" */
function placeLabel(place: Place): string {
  const parts = [place.barangay, place.locality, place.province].filter((p, i, all): p is string => !!p && all.indexOf(p) === i)
  return parts.length > 0 ? parts.join(', ') : place.display_name.split(',').slice(0, 3).join(',').trim()
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

/** What we send to /api/analyze. Found headlines stand in for news the person didn't type. */
function analyzeRequest(input: AnalyzeInput, result?: LocateResult): { sent: AnalyzeInput; context?: AnalyzeContext } {
  const headlines = result?.news.articles.map((a) => a.title).join('. ') ?? ''
  return {
    sent: { ...input, data: { ...input.data, news_text: input.data.news_text.trim() || headlines } },
    context: result && {
      place: result.place,
      amenities: result.amenities,
      news_articles: result.news.articles,
      measured: Object.values(result.sources).includes('openstreetmap'),
    },
  }
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const id = useId()
  return (
    <section role="group" aria-labelledby={id} data-reveal className="flex flex-col gap-lg rounded-lg border border-hairline bg-surface p-md sm:p-lg">
      <div className="flex flex-col gap-xxs">
        <h2 id={id} className="text-tagline font-semibold">
          {title}
        </h2>
        {hint && <p className="text-caption text-ink-secondary">{hint}</p>}
      </div>
      <div className="flex flex-col">{children}</div>
    </section>
  )
}

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: MousePointerClick, title: 'Pin the lot', body: 'Click the map where the lot is, or search for the place.' },
  { icon: SlidersHorizontal, title: 'Check the values', body: 'We fill them in from map and regional data. Change any you know better.' },
  { icon: FileText, title: 'Open the report', body: 'Price per sqm, a growth grade, and the offices to visit before you buy.' },
]

function Steps() {
  return (
    <ol data-reveal className="flex flex-col gap-lg rounded-lg border border-hairline bg-surface p-md sm:p-lg">
      {STEPS.map(({ icon: Icon, title, body }, i) => (
        <li key={title} className="flex items-start gap-md">
          <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-pill bg-surface-raised text-ink">
            <Icon size={22} strokeWidth={1.75} />
          </span>
          <span className="flex flex-col">
            <span className="text-caption text-ink-secondary">Step {i + 1}</span>
            <span className="font-semibold">{title}</span>
            <span className="text-caption text-ink-secondary">{body}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-xxs rounded-pill bg-surface-raised px-sm py-xxs text-caption text-ink-secondary">{children}</span>
}

function PlaceFound({ lookup, updating }: { lookup: LocateResult; updating: boolean }) {
  const { place, news } = lookup
  return (
    <section
      aria-label="Place found"
      className={`flex flex-col gap-md rounded-lg border border-hairline bg-surface p-md transition-opacity duration-200 sm:p-lg ${updating ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start gap-sm">
        <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-pill bg-accent-fill text-on-accent">
          <MapPin size={22} strokeWidth={2} />
        </span>
        <div className="flex min-w-0 flex-col gap-xxs">
          <p className="text-tagline font-semibold">{placeLabel(place)}</p>
          <p className="text-caption text-ink-secondary">{place.display_name}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-xs">
        <Chip>
          {place.pinned
            ? `Pinned at ${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}`
            : place.source === 'openstreetmap'
              ? 'Found on OpenStreetMap'
              : 'Matched from our list of reference areas'}
        </Chip>
        {place.elevation_m != null && <Chip>{Math.round(place.elevation_m)} m above sea level</Chip>}
        {place.region && <Chip>{place.region}</Chip>}
      </div>
      {news.articles.length > 0 && (
        <div className="flex flex-col gap-xs border-t border-hairline pt-md">
          <p className="flex items-center gap-xs font-semibold">
            <Newspaper size={18} strokeWidth={1.75} className="text-ink-secondary" aria-hidden />
            Recent news we found
          </p>
          <ul className="flex flex-col">
            {news.articles.slice(0, 3).map((a) => (
              <li key={a.title} className="border-b border-hairline py-xs text-caption last:border-b-0">
                <span className="line-clamp-2">{a.title}</span>
                {a.source && <span className="text-ink-secondary">{a.source}</span>}
              </li>
            ))}
          </ul>
          <p className="text-caption text-ink-secondary">These headlines count toward the growth score.</p>
        </div>
      )}
    </section>
  )
}

/** Dark card with the price, recounted every time the pin or a value moves */
function LiveEstimate({ preview, updating, failed, className = '' }: { preview: Preview | null; updating: boolean; failed: boolean; className?: string }) {
  const r = preview?.result
  return (
    <section aria-label="Live estimate" className={`frosted-dark flex flex-col gap-md rounded-lg p-lg text-on-tile ${className}`}>
      <div className="flex items-center justify-between gap-sm">
        <p className="text-caption font-semibold text-on-tile-secondary">Live estimate</p>
        <p className="inline-flex items-center gap-xs text-caption text-on-tile-secondary">
          <span
            aria-hidden
            className={`size-2 rounded-pill ${failed ? 'bg-critical-on-tile' : updating ? 'animate-pulse-dot bg-on-tile' : 'bg-positive-on-tile'}`}
          />
          {failed ? "Couldn't update" : updating ? 'Updating' : 'Up to date'}
        </p>
      </div>
      {r ? (
        <div className={`flex flex-col gap-sm transition-opacity duration-200 ${updating ? 'opacity-60' : ''}`}>
          <p className="flex flex-wrap items-baseline gap-x-xs">
            <span className="text-display-lg">
              <CountUp value={r.predicted_price_sqm} format={peso} />
            </span>
            <span className="text-on-tile-secondary">per sqm</span>
          </p>
          {typeof r.price_low === 'number' && typeof r.price_high === 'number' && (
            <p className="text-caption tabular-nums text-on-tile-secondary">
              Likely {formatPeso(r.price_low)} to {formatPeso(r.price_high)}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-sm">
            <GradeBadge grade={parseGrade(r.category)} onTile />
            <span className="text-caption tabular-nums text-on-tile-secondary">Growth score {Math.round(r.growth_score)} of 100</span>
          </div>
        </div>
      ) : (
        <div aria-hidden className="flex flex-col gap-sm">
          <div className="h-10 w-3/5 animate-shimmer rounded-sm bg-tile-hairline" />
          <div className="h-4 w-2/5 animate-shimmer rounded-sm bg-tile-hairline" />
        </div>
      )}
      <p className="border-t border-tile-hairline pt-sm text-caption text-on-tile-secondary">
        Drag the pin or change a value to see the price move.
      </p>
    </section>
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
  const [pin, setPin] = useState<Point | null>(null)
  const [finding, setFinding] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const [errors, setErrors] = useState<Errors>({})
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [failure, setFailure] = useState<unknown>(null)
  const abortRef = useRef<AbortController | null>(null)
  const pageRef = useRef<HTMLFormElement>(null)
  useReveal(pageRef)

  useEffect(() => () => abortRef.current?.abort(), [])

  // /check?lat=&lon= opens with that spot pinned, such as from a listing's "Check this spot"
  const [params] = useSearchParams()
  const pinnedFromUrl = useRef(false)
  useEffect(() => {
    if (pinnedFromUrl.current || !params.get('lat') || !params.get('lon')) return
    const lat = Number(params.get('lat'))
    const lon = Number(params.get('lon'))
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return
    pinnedFromUrl.current = true
    void onPin(lat, lon)
    // Runs once on arrival; later pins come from the map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fresh = lookup !== null && lookup.query === location.trim()
  // Changes whenever the place or any value changes, which is when the estimate is out of date
  const previewKey = fresh ? JSON.stringify([lookup.result.place.lat, lookup.result.place.lon, data]) : null

  useEffect(() => {
    if (!previewKey || !lookup) return
    const input: AnalyzeInput = { location: location.trim(), data }
    if (Object.keys(validate(input)).length > 0) return
    const { sent, context } = analyzeRequest(input, lookup.result)
    const controller = new AbortController()
    // Wait for the slider to settle before asking
    const timer = window.setTimeout(() => {
      analyzeLocation(sent, context, controller.signal)
        .then((result) => setPreview({ key: previewKey, input, result }))
        .catch((err) => {
          if ((err as Error).name !== 'AbortError') setFailedKey(previewKey)
        })
    }, 450)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [previewKey, lookup, location, data])

  const previewReady = previewKey !== null && preview?.key === previewKey
  const previewUpdating = previewKey !== null && !previewReady && failedKey !== previewKey

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

  function newController() {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    return controller
  }

  /** Fills the form from a lookup. Values the person changed stay as they are. */
  function apply(result: LocateResult, query: string) {
    const next = { query, result }
    const merged = mergeFactors(data, result, touched)
    setLookup(next)
    setData(merged)
    return { data: merged, lookup: next }
  }

  /** Looks the place up by name and fills the form. Returns the merged values, or null on failure. */
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
      setPin({ lat: result.place.lat, lon: result.place.lon })
      return apply(result, query)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return null
      setFailure(err)
      setStatus('error')
      if (err instanceof ApiError && err.kind === 'not-found') {
        setErrors((e) => ({ ...e, location: "We couldn't find this place. Add the town or province." }))
      }
      return null
    } finally {
      // A newer lookup may have started; it clears this flag itself
      if (abortRef.current?.signal === signal) setFinding(false)
    }
  }

  /** Looks up the exact spot on the map and refills the form */
  async function onPin(lat: number, lon: number) {
    const controller = newController()
    setPin({ lat, lon })
    if (!inPhilippines({ lat, lon })) {
      setErrors((e) => ({ ...e, location: 'Move the pin to a spot in the Philippines.' }))
      setFinding(false)
      return
    }
    setErrors((e) => ({ ...e, location: undefined }))
    setFinding(true)
    setFailure(null)
    setStatus('idle')
    try {
      const result = await locatePoint(lat, lon, controller.signal)
      const label = placeLabel(result.place)
      setLocation(label)
      apply(result, label)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      if (err instanceof ApiError && err.kind === 'not-found') {
        setErrors((e) => ({ ...e, location: 'There is no land at this spot. Move the pin onto the lot.' }))
      } else {
        setFailure(err)
        setStatus('error')
      }
    } finally {
      if (abortRef.current === controller) setFinding(false)
    }
  }

  function onUseMyLocation() {
    navigator.geolocation.getCurrentPosition(
      (pos) => void onPin(pos.coords.latitude, pos.coords.longitude),
      () =>
        setErrors((e) => ({
          ...e,
          location: "We couldn't get your location. Allow location access, or put the pin on the map.",
        })),
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  function openReport(input: AnalyzeInput, result: AnalyzeResult) {
    const id = newReportId()
    storeDraft({ id, createdAt: new Date().toISOString(), input, result })
    navigate(`/reports/${id}`, { state: { fresh: true } })
  }

  async function run() {
    // The live estimate already scored these exact values
    if (previewReady && preview) {
      openReport(preview.input, preview.result)
      return
    }

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

    const { sent, context } = analyzeRequest(input, current.lookup?.result)
    setStatus('loading')
    setFailure(null)
    try {
      openReport(input, await analyzeLocation(sent, context, controller.signal))
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
  const showValues = lookup !== null || prefill !== undefined
  const sourceNote = (key: FactorKey) => {
    if (touched.has(key)) return 'Changed by you'
    if (!fresh || !lookup) return undefined
    return SOURCE_LABEL[lookup.result.sources[key]]
  }

  function factorFields(group: 'area' | 'access') {
    return FACTORS.filter((f) => f.group === group).map((f) => {
      const Icon = FACTOR_ICONS[f.key]
      return (
        <RangeField
          key={f.key}
          label={f.label}
          hint={f.hint}
          note={sourceNote(f.key)}
          icon={<Icon size={20} strokeWidth={1.75} />}
          min={f.min}
          max={f.max}
          step={f.step}
          unit={f.unit}
          value={data[f.key]}
          onChange={(v) => setFactor(f.key, v)}
          error={errors[f.key]}
        />
      )
    })
  }

  const estimate = (className: string) =>
    lookup && (fresh || finding) ? (
      <LiveEstimate preview={preview} updating={previewUpdating || finding} failed={failedKey === previewKey && previewKey !== null} className={className} />
    ) : null

  return (
    <form
      ref={pageRef}
      onSubmit={onSubmit}
      noValidate
      aria-busy={busy}
      className="lg:grid lg:grid-cols-[minmax(0,1fr)_34rem] xl:grid-cols-[minmax(0,1fr)_38rem]"
    >
      {/* Map pane: full height beside the panel on wide screens, on top on phones */}
      <div className="relative h-[58dvh] min-h-96 bg-surface-raised lg:sticky lg:top-24 lg:h-[calc(100dvh-6rem)]">
        <PinMapView
          point={pin}
          zoom={lookup?.result.place.kind === 'center' ? 13 : 16}
          amenities={fresh ? lookup?.result.amenities : undefined}
          onPick={(lat, lon) => void onPin(lat, lon)}
          className="h-full"
        />

        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-xs p-sm pr-16 sm:p-md sm:pr-18 lg:max-w-152">
          <div className="frosted pointer-events-auto flex items-center gap-xxs rounded-pill border border-hairline py-xxs pl-md pr-xxs focus-within:ring-2 focus-within:ring-focus">
            <Search size={18} className="shrink-0 text-ink-secondary" aria-hidden />
            <label htmlFor="location" className="sr-only">
              City, town, or barangay
            </label>
            <input
              id="location"
              name="location"
              type="search"
              placeholder="Search a city, town, or barangay"
              autoComplete="address-level2"
              list="place-suggestions"
              value={location}
              onChange={(e) => {
                setLocation(e.target.value)
                if (errors.location) setErrors((x) => ({ ...x, location: undefined }))
              }}
              onKeyDown={(e) => {
                // Enter in the search box finds the place instead of opening the report
                if (e.key === 'Enter' && !fresh) {
                  e.preventDefault()
                  void findPlace(newController().signal)
                }
              }}
              aria-invalid={!!errors.location}
              aria-describedby={errors.location ? 'location-error' : undefined}
              className="h-tap min-w-0 flex-1 bg-transparent px-xs text-body text-ink outline-none placeholder:text-ink-secondary [&::-webkit-search-cancel-button]:hidden"
            />
            {!fresh && (
              <Button
                disabled={busy || location.trim().length < 2}
                onClick={() => void findPlace(newController().signal)}
                className="max-sm:size-tap max-sm:px-0"
                icon={
                  finding ? (
                    <LoaderCircle size={18} className="animate-spin" aria-hidden />
                  ) : (
                    <ArrowRight size={18} className="sm:hidden" aria-hidden />
                  )
                }
              >
                {/* Icon only on phones, so the search box keeps its width */}
                <span className="max-sm:sr-only">Find place</span>
              </Button>
            )}
            {'geolocation' in navigator && (
              <button
                type="button"
                onClick={onUseMyLocation}
                disabled={loading}
                aria-label="Use my location"
                title="Use my location"
                className="press flex size-tap shrink-0 items-center justify-center rounded-pill text-accent hover:bg-surface-raised"
              >
                <LocateFixed size={20} aria-hidden />
              </button>
            )}
          </div>
          <datalist id="place-suggestions">
            {PLACE_SUGGESTIONS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          {errors.location && (
            <p id="location-error" className="frosted pointer-events-auto inline-flex items-center gap-xxs self-start rounded-pill px-md py-xs text-caption text-critical">
              <CircleAlert size={16} strokeWidth={2} aria-hidden />
              {errors.location}
            </p>
          )}
          {finding && (
            <p className="frosted inline-flex items-center gap-xs self-start rounded-pill px-md py-xs text-caption text-ink">
              <LoaderCircle size={16} className="animate-spin" aria-hidden />
              {pin ? 'Updating the values for this spot' : 'Finding this place'}
            </p>
          )}
        </div>

        {!pin && !finding && (
          <p className="frosted pointer-events-none absolute bottom-lg left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-xs whitespace-nowrap rounded-pill px-md py-xs text-caption text-ink">
            <MousePointerClick size={16} aria-hidden />
            Click the map to put a pin on the lot
          </p>
        )}

        {estimate('absolute bottom-lg left-lg z-10 hidden w-96 lg:flex')}
      </div>

      {/* Panel */}
      <div className="flex flex-col bg-canvas-alt">
        <div className="flex flex-1 flex-col gap-lg p-md sm:p-lg lg:p-xl">
          <header data-reveal className="flex flex-col gap-xs">
            <h1 className="text-display-md">Check a location</h1>
            <p className="text-ink-secondary">
              Pin the lot on the map, or search for the place. We fill in the details from map, regional, and news data. You can
              change any value you know better.
            </p>
          </header>

          {/* On phones the price comes first, right under the map */}
          {estimate('lg:hidden')}

          {lookup ? (
            <PlaceFound lookup={lookup.result} updating={finding} />
          ) : finding ? (
            <div aria-hidden className="flex flex-col gap-sm rounded-lg border border-hairline bg-surface p-lg">
              <Skeleton className="h-6 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : (
            !prefill && <Steps />
          )}

          {showValues && (
            <>
              <Section title="The area" hint="Filled in for this place. These shape the growth score the most.">
                {factorFields('area')}
              </Section>

              <Section title="Getting around" hint="Closer amenities raise both price and growth.">
                {factorFields('access')}
                {fresh && touched.size > 0 && (
                  <Button variant="plain" className="-ml-xs mt-md self-start" icon={<RotateCcw size={18} aria-hidden />} onClick={resetToFound}>
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
            </>
          )}

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
        </div>

        <div className="frosted sticky bottom-0 z-20 flex flex-col gap-xs border-t border-hairline px-md py-sm sm:flex-row sm:items-center sm:justify-between sm:px-lg lg:px-xl">
          <p className="hidden text-caption text-ink-secondary sm:block">
            {previewReady ? 'Opens at once. Nothing is saved until you choose to.' : 'Takes a few seconds. Nothing is saved until you choose to.'}
          </p>
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
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {finding
          ? pin
            ? 'Updating the values for the pinned spot.'
            : `Finding ${location.trim()}.`
          : loading
            ? `Checking ${location.trim()}. This takes a few seconds.`
            : previewReady && preview
              ? `Estimated ${formatPeso(preview.result.predicted_price_sqm)} per square meter for ${location.trim()}.`
              : fresh && lookup
                ? `Found ${lookup.result.place.display_name}. The form is filled in.`
                : ''}
      </p>
    </form>
  )
}
