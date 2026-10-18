import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Building2,
  CircleCheck,
  ExternalLink,
  Hospital,
  MapPin,
  Navigation,
  Mountain,
  Newspaper,
  School,
  ShoppingBag,
  Store,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { officeLocations, type Amenity, type OfficeKind, type OfficeLocation } from '../lib/api'
import type { Report } from '../lib/reports'
import { GRADE_ORDER, formatPeso, gradeInfo, insightTone, parseGrade, splitInsights } from '../lib/format'
import { FACTORS, type FactorKey } from '../lib/presets'
import { usePlayOnView } from '../lib/motion'
import { CountUp } from './CountUp'
import { GradeBadge, Ring } from './Grade'
import { MapView } from './Map'
import type { MapPlace } from './LotMap'
import { Skeleton } from './States'
import { Listings } from './Listings'
import { NearbyPlaces } from './NearbyPlaces'

const SENTIMENT_COPY = {
  positive: 'Mostly good news for the area.',
  negative: 'Mostly bad news for the area.',
  neutral: 'No clear signal either way.',
}

const CONFIDENCE_COPY = {
  high: 'Reference prices are close by and the area was measured from map data.',
  medium: 'Reference prices are within 25 km. Compare with local listings.',
  low: 'Few reference prices nearby. Treat this as a rough guide.',
}

const LOT_SIZES = [100, 200, 300, 500, 1000]

const AMENITIES: { type: Amenity['type']; factor: FactorKey; label: string; icon: LucideIcon }[] = [
  { type: 'mall', factor: 'proximity_to_mall', label: 'Nearest mall', icon: ShoppingBag },
  { type: 'school', factor: 'proximity_to_school', label: 'Nearest school', icon: School },
  { type: 'hospital', factor: 'proximity_to_hospital', label: 'Nearest hospital', icon: Hospital },
  { type: 'center', factor: 'distance_to_amenities', label: 'Town center', icon: Store },
]

const peso = (n: number) => formatPeso(Math.round(n))
const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1)

export function Card({
  title,
  intro,
  children,
  className = '',
}: {
  title: string
  intro?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section data-reveal className={`flex flex-col gap-lg rounded-lg border border-hairline bg-surface p-md sm:p-lg print:break-inside-avoid ${className}`}>
      <div className="flex flex-col gap-xxs">
        <h2 className="text-tagline font-semibold">{title}</h2>
        {intro && <p className="text-caption text-ink-secondary">{intro}</p>}
      </div>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-tap items-center justify-between gap-md border-b border-hairline py-xs">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className="min-w-0 text-right tabular-nums">{children}</dd>
    </div>
  )
}

/** Where the estimate sits between the low and high ends of its range */
function RangeBar({ low, high, value }: { low: number; high: number; value: number }) {
  const span = Math.log(high) - Math.log(low)
  const pos = span > 0 ? Math.min(100, Math.max(0, ((Math.log(value) - Math.log(low)) / span) * 100)) : 50
  return (
    <div className="flex max-w-112 flex-col gap-xs">
      <div className="relative h-2 rounded-pill bg-tile-hairline">
        <div className="absolute inset-0 origin-left animate-grow rounded-pill bg-on-tile-secondary opacity-40" />
        <span
          aria-hidden
          className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-pill bg-on-tile ring-4 ring-black print:ring-0"
          style={{ left: `${pos}%` }}
        />
      </div>
      <div className="flex justify-between text-caption text-on-tile-secondary tabular-nums">
        <span>{formatPeso(low)}</span>
        <span>{formatPeso(high)}</span>
      </div>
    </div>
  )
}

/**
 * The dark opening band of a report: place, grade, price, and the map.
 * `back` and `eyebrow` differ between your own report and a shared one.
 */
export function ReportHero({ report, eyebrow, back }: { report: Report; eyebrow: string; back?: ReactNode }) {
  const { result } = report
  const grade = parseGrade(result.category)
  const geo = result.geo_data
  const hasPoint = typeof geo?.lat === 'number' && typeof geo?.lon === 'number'
  const hasRange = typeof result.price_low === 'number' && typeof result.price_high === 'number'

  return (
    <section className="tile-print bg-black text-on-tile">
      <div
        className={`gutter mx-auto grid gap-xl pb-xxl pt-lg lg:items-center lg:pb-section ${hasPoint ? 'max-w-grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:gap-xxl' : 'max-w-reading'}`}
      >
        <div className="flex min-w-0 flex-col gap-xl">
          <div className="flex flex-col gap-sm">
            {back}
            <div data-reveal className="flex flex-col gap-sm">
              <p className="text-caption text-on-tile-secondary">{eyebrow}</p>
              <h1 className="text-display-md sm:text-display-lg lg:text-hero">{result.location}</h1>
              <div className="pt-xxs">
                <GradeBadge grade={grade} size="large" onTile />
              </div>
            </div>
          </div>

          <div data-reveal data-reveal-delay="0.1" className="flex flex-col gap-md">
            <div className="flex flex-col gap-xxs">
              <p className="text-on-tile-secondary">Estimated price</p>
              <p className="text-display-lg sm:text-figure">
                <CountUp value={result.predicted_price_sqm} format={peso} />
              </p>
              <p className="text-on-tile-secondary">per square meter</p>
            </div>
            {hasRange && (
              <div className="flex flex-col gap-sm">
                <p className="tabular-nums">
                  Likely between <span className="font-semibold">{formatPeso(result.price_low!)}</span> and{' '}
                  <span className="font-semibold">{formatPeso(result.price_high!)}</span>
                </p>
                <RangeBar low={result.price_low!} high={result.price_high!} value={result.predicted_price_sqm} />
                {result.confidence && (
                  <p className="max-w-112 text-caption text-on-tile-secondary">
                    <span className="font-semibold text-on-tile">{capitalize(result.confidence)} confidence.</span>{' '}
                    {CONFIDENCE_COPY[result.confidence]}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {hasPoint && (
          <div data-reveal data-reveal-delay="0.2" className="flex min-w-0 flex-col gap-xs">
            <MapView
              lat={geo!.lat!}
              lon={geo!.lon!}
              label={geo!.name ?? result.location}
              amenities={geo!.amenities}
              comps={result.comps}
              className="h-80 rounded-lg shadow-product sm:h-112 lg:h-128"
            />
            <p className="flex items-center gap-xxs text-caption text-on-tile-secondary tabular-nums">
              <MapPin size={14} aria-hidden />
              {geo!.lat!.toFixed(5)}, {geo!.lon!.toFixed(5)}
              {geo!.elevation_m != null && (
                <>
                  <span aria-hidden> · </span>
                  {Math.round(geo!.elevation_m)} m above sea level
                </>
              )}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

function Scores({ report }: { report: Report }) {
  const ref = useRef<HTMLElement>(null)
  usePlayOnView(ref)
  const { result } = report
  const grade = parseGrade(result.category)
  const f = result.feature_analysis
  return (
    <section ref={ref} aria-labelledby="scores-title" className="bg-canvas py-xxl sm:py-section print:break-inside-avoid">
      <div className="gutter mx-auto flex max-w-reading flex-col items-center gap-xxl">
        <div data-reveal className="flex max-w-prose flex-col items-center gap-sm text-center">
          <h2 id="scores-title" className="text-display-md">
            How this lot scores
          </h2>
          <p className="text-lead-airy font-light text-ink-secondary">
            {grade.label}. {grade.summary}
          </p>
        </div>
        <div data-reveal className={`grid w-full gap-xl xs:grid-cols-2 ${f ? 'md:grid-cols-4' : ''}`}>
          <Ring label="Growth score" value={Math.round(result.growth_score)} max={100} hint="How strongly local conditions point to rising prices." />
          {f && (
            <>
              <Ring label="Amenities" value={Math.min(10, f.amenity_score)} max={10} hint="Closeness to malls, schools, and hospitals." />
              <Ring label="Economy" value={Math.min(10, f.economic_score)} max={10} hint="Regional GDP and population growth." />
              <Ring label="Risk" value={Math.min(10, f.risk_score)} max={10} invert hint="Typhoon, flood, and weak infrastructure. Lower is better." />
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function LotCost({ report }: { report: Report }) {
  const [lotSize, setLotSize] = useState(300)
  const { result } = report
  const valid = Number.isFinite(lotSize) && lotSize > 0
  const hasRange = typeof result.price_low === 'number' && typeof result.price_high === 'number'
  return (
    <section aria-labelledby="lot-title" className="bg-canvas-alt py-xxl sm:py-section print:break-inside-avoid">
      <div className="gutter mx-auto flex max-w-reading flex-col items-center gap-xl text-center">
        <div data-reveal className="flex flex-col items-center gap-sm">
          <h2 id="lot-title" className="text-display-md">
            What the whole lot costs
          </h2>
          <p className="text-ink-secondary">Pick a lot size, or type your own.</p>
        </div>

        <div data-reveal className="flex flex-col items-center gap-md print:hidden">
          <div role="group" aria-label="Common lot sizes" className="flex flex-wrap justify-center gap-xs">
            {LOT_SIZES.map((size) => {
              const on = lotSize === size
              return (
                <button
                  key={size}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setLotSize(size)}
                  className={`press min-h-tap rounded-pill bg-surface px-md tabular-nums text-ink ${on ? 'border-2 border-focus font-semibold' : 'border border-hairline'}`}
                >
                  {size.toLocaleString('en-PH')} sqm
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-xs">
            <label htmlFor="lot-size" className="font-semibold">
              Lot size
            </label>
            <input
              id="lot-size"
              type="number"
              inputMode="numeric"
              min={1}
              value={Number.isNaN(lotSize) ? '' : lotSize}
              onChange={(e) => setLotSize(e.target.value === '' ? NaN : Number(e.target.value))}
              className="h-tap w-32 rounded-pill border border-hairline bg-surface px-md text-right tabular-nums text-ink focus-visible:border-focus"
            />
            <span className="text-ink-secondary">sqm</span>
          </div>
        </div>

        <div data-reveal className="flex flex-col items-center gap-xs" aria-live="polite">
          {valid ? (
            <>
              <p className="text-display-lg sm:text-figure">
                <CountUp value={result.predicted_price_sqm * lotSize} format={peso} />
              </p>
              <p className="tabular-nums text-ink-secondary">
                About this much for {lotSize.toLocaleString('en-PH')} sqm at {formatPeso(result.predicted_price_sqm)} per sqm
                {hasRange && (
                  <>
                    <br />
                    Likely {formatPeso(result.price_low! * lotSize)} to {formatPeso(result.price_high! * lotSize)}
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="text-ink-secondary">Enter a lot size to see the total.</p>
          )}
        </div>
      </div>
    </section>
  )
}

/** Each reference area's price range on one log scale, with this lot on top */
function PriceScale({ report }: { report: Report }) {
  const ref = useRef<HTMLUListElement>(null)
  usePlayOnView(ref)
  const { result } = report
  const comps = result.comps ?? []
  const est = result.predicted_price_sqm
  const rows = [
    { key: 'self', name: 'This lot', detail: 'Our estimate', low: result.price_low ?? est, high: result.price_high ?? est, self: true },
    ...comps.map((c) => ({
      key: `${c.name}-${c.province}`,
      name: c.name,
      detail: `${c.province} · ${c.distance_km} km`,
      low: c.price_low,
      high: c.price_high,
      self: false,
    })),
  ]
  const lo = Math.min(...rows.map((r) => r.low)) * 0.85
  const hi = Math.max(...rows.map((r) => r.high)) * 1.1
  const pos = (v: number) => ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * 100
  const estPos = pos(est)

  return (
    <Card
      title="Nearby reference prices"
      intro="The estimate starts from these areas, weighted by how close they are. They are typical asking prices, not official zonal values."
    >
      <ul ref={ref} className="flex flex-col">
        {rows.map((r, i) => (
          <li key={r.key} className="grid grid-cols-[minmax(0,1fr)] border-b border-hairline last:border-b-0 sm:grid-cols-[11rem_minmax(0,1fr)_10rem]">
            <div className="flex flex-col pt-sm sm:py-sm">
              <span className={r.self ? 'font-semibold' : ''}>{r.name}</span>
              <span className="text-caption text-ink-secondary">{r.detail}</span>
            </div>
            <div aria-hidden className="relative min-h-10 self-stretch sm:mx-md">
              <span className="absolute inset-y-0 border-l border-dashed border-ink-secondary" style={{ left: `${estPos}%` }} />
              <span
                className={`absolute top-1/2 h-2 origin-left -translate-y-1/2 animate-grow rounded-pill ${r.self ? 'bg-ink' : 'bg-ink-secondary opacity-40'}`}
                style={{ left: `${pos(r.low)}%`, width: `${Math.max(1.5, pos(r.high) - pos(r.low))}%`, animationDelay: `${i * 80}ms` }}
              />
              {r.self && (
                <span
                  className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-pill bg-ink ring-4 ring-surface"
                  style={{ left: `${estPos}%` }}
                />
              )}
            </div>
            <p className={`pb-sm text-caption tabular-nums sm:py-sm sm:text-right sm:text-body ${r.self ? 'font-semibold' : 'text-ink-secondary'}`}>
              {formatPeso(r.low)} to {formatPeso(r.high)}
            </p>
          </li>
        ))}
      </ul>
      <p className="text-caption text-ink-secondary">
        The dashed line marks our estimate, {formatPeso(est)} per sqm. The scale is logarithmic, so each step is a multiple, not a fixed
        amount.
      </p>
    </Card>
  )
}

function Surroundings({ report }: { report: Report }) {
  const { result, input } = report
  const geo = result.geo_data
  const measured = new Map((geo?.amenities ?? []).map((a) => [a.type, a]))
  return (
    <Card title="Around the lot" intro="Distances are straight-line. Road distance is usually longer.">
      <ul className="grid grid-cols-2 gap-sm md:grid-cols-4">
        {AMENITIES.map(({ type, factor, label, icon: Icon }) => {
          const hit = measured.get(type)
          return (
            <li key={type} className="flex flex-col gap-xs rounded-lg bg-surface-raised p-md">
              <Icon size={22} strokeWidth={1.75} className="text-ink-secondary" aria-hidden />
              <p className="text-display-sm tabular-nums">
                {(hit?.distance_km ?? input.data[factor]).toFixed(1)}
                <span className="text-body font-regular text-ink-secondary"> km</span>
              </p>
              <p className="flex flex-col">
                <span className="font-semibold">{label}</span>
                <span className="truncate text-caption text-ink-secondary" title={hit?.name ?? undefined}>
                  {hit ? hit.name ?? 'Measured on the map' : 'Estimated'}
                </span>
              </p>
            </li>
          )
        })}
      </ul>
      {geo?.display_name && (
        <dl>
          <Row label="Found as">
            <span className="block truncate" title={geo.display_name}>
              {geo.display_name}
            </span>
          </Row>
          {geo.elevation_m != null && (
            <Row label="Elevation">
              <span className="inline-flex items-center gap-xxs">
                <Mountain size={16} className="text-ink-secondary" aria-hidden />
                {Math.round(geo.elevation_m)} m{geo.elevation_source === 'postgis' ? ' (30 m terrain model)' : ''}
              </span>
            </Row>
          )}
        </dl>
      )}
    </Card>
  )
}

function Drivers({ insights }: { insights: string[] }) {
  const good = insights.filter((t) => insightTone(t) === 'positive')
  const watch = insights.filter((t) => insightTone(t) === 'caution')
  const column = (title: string, items: string[], tone: 'positive' | 'caution') => {
    const Icon = tone === 'caution' ? TriangleAlert : CircleCheck
    return (
      <div className="flex flex-col gap-sm">
        <h3 className={`inline-flex items-center gap-xs font-semibold ${tone === 'caution' ? 'text-caution' : 'text-positive'}`}>
          <Icon size={20} strokeWidth={2} aria-hidden />
          {title}
        </h3>
        {items.length > 0 ? (
          <ul className="flex flex-col">
            {items.map((text) => (
              <li key={text} className="border-b border-hairline py-sm last:border-b-0">
                {text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-secondary">Nothing stood out.</p>
        )}
      </div>
    )
  }
  return (
    <Card title="What drives this result">
      <div className="grid gap-xl md:grid-cols-2">
        {column('Working for this lot', good, 'positive')}
        {column('Watch out for', watch, 'caution')}
      </div>
    </Card>
  )
}

function News({ report }: { report: Report }) {
  const { result, input } = report
  const news = result.news_analysis
  if (!news) return null
  const own = input.data.news_text.trim()
  const articles = result.news_articles ?? []
  if (!own && articles.length === 0) return null
  const topics = Array.isArray(news.insights) ? news.insights : []
  return (
    <Card title="News check">
      <div className="flex flex-col gap-sm">
        <p className="flex items-start gap-sm">
          <Newspaper size={22} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink-secondary" aria-hidden />
          <span>
            <span className="font-semibold">{capitalize(news.sentiment)}.</span> {SENTIMENT_COPY[news.sentiment]}
          </span>
        </p>
        {topics.length > 0 && (
          <ul className="flex flex-wrap gap-xs">
            {topics.map((t) => (
              <li key={t} className="rounded-pill bg-surface-raised px-sm py-xxs text-caption text-ink-secondary">
                {t}
              </li>
            ))}
          </ul>
        )}
      </div>
      {own ? (
        <blockquote className="border-l-2 border-hairline pl-sm text-ink-secondary">{own}</blockquote>
      ) : (
        <ul className="grid gap-sm sm:grid-cols-2">
          {articles.map((a) => {
            const meta = [a.source, a.published].filter(Boolean).join(' · ')
            const body = (
              <>
                <span className="text-caption text-ink-secondary">{meta}</span>
                <span className="line-clamp-3 font-semibold">{a.title}</span>
              </>
            )
            return (
              <li key={a.title} className="flex">
                {a.url ? (
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="press group flex w-full flex-col gap-xs rounded-lg border border-hairline p-md transition-colors hover:bg-surface-raised"
                  >
                    {body}
                    <span className="mt-auto inline-flex items-center gap-xxs pt-xs text-caption text-accent">
                      Read the story
                      <ExternalLink size={14} aria-hidden />
                      <span className="sr-only">(opens in a new tab)</span>
                    </span>
                  </a>
                ) : (
                  <div className="flex w-full flex-col gap-xs rounded-lg border border-hairline p-md">{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

// Offices on reports made before they had a `kind` are always in this order
const OFFICE_ORDER: OfficeKind[] = ['assessor', 'bir', 'registry', 'planning']

function directionsUrl(from: { lat: number; lon: number }, to: OfficeLocation | null | undefined, name: string) {
  const destination = to ? `${to.lat},${to.lon}` : `${name}, Philippines`
  return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lon}&destination=${encodeURIComponent(destination)}`
}

/** The offices to visit, on a map with the lot, each with directions from the lot */
function BeforeYouBuy({ report }: { report: Report }) {
  const { result } = report
  const offices = result.offices ?? []
  const geo = result.geo_data
  const lot = typeof geo?.lat === 'number' && typeof geo?.lon === 'number' ? { lat: geo.lat, lon: geo.lon } : null
  const town = geo?.locality ?? geo?.name ?? null
  const [found, setFound] = useState<Partial<Record<OfficeKind, OfficeLocation | null>> | null>(null)

  useEffect(() => {
    if (!lot || !town) return
    const controller = new AbortController()
    officeLocations({ town, province: geo?.province, lat: lot.lat, lon: lot.lon }, controller.signal)
      .then(setFound)
      .catch((err) => {
        // Without positions the list and the name-based directions still work
        if ((err as Error).name !== 'AbortError') setFound({})
      })
    return () => controller.abort()
    // The lot never changes for a report
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.id])

  const rows = offices.map((o, i) => ({ ...o, n: i + 1, loc: found?.[o.kind ?? OFFICE_ORDER[i]] ?? null }))

  // Offices in the same building or compound (the assessor and planning offices
  // are both in the city hall) share one marker labeled with every number, so
  // no marker hides under another
  const places = useMemo(() => {
    const merged: MapPlace[] = []
    for (const r of rows) {
      if (!r.loc) continue
      const { lat, lon } = r.loc
      // About 200 m; good enough at Philippine latitudes
      const near = merged.find((m) => Math.hypot(m.lat - lat, m.lon - lon) < 0.0018)
      if (near) {
        near.n += `, ${r.n}`
        near.label += ` and ${r.name}`
      } else {
        merged.push({ n: String(r.n), lat, lon, label: r.name })
      }
    }
    return merged
    // rows is rebuilt each render; found is what changes it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found])

  const loading = lot !== null && town !== null && found === null

  return (
    <Card title="Before you buy" intro="Check the lot with these offices. They hold the official records.">
      <div className={`grid gap-xl ${lot ? 'md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]' : ''}`}>
        <ol className="flex flex-col gap-md">
          {result.agency?.name && (
            <li className="flex items-start gap-sm">
              <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-surface-raised text-ink-secondary">
                <Building2 size={18} strokeWidth={1.75} />
              </span>
              <span>
                <span className="block font-semibold">{result.agency.name}</span>
                <span className="block text-caption text-ink-secondary">
                  {[result.agency.address, result.agency.phone, result.agency.email].filter(Boolean).join(' · ') || 'Local contact'}
                </span>
              </span>
            </li>
          )}
          {rows.map((o) => (
            <li key={o.name} className="flex items-start gap-sm">
              <span
                aria-hidden
                className={`flex size-10 shrink-0 items-center justify-center rounded-pill font-semibold tabular-nums ${o.loc ? 'bg-ink text-canvas' : 'bg-surface-raised text-ink-secondary'}`}
              >
                {o.n}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold">{o.name}</span>
                <span className="text-caption text-ink-secondary">{o.purpose}</span>
                {o.loc && <span className="text-caption text-ink-secondary">On the map at {o.loc.name}</span>}
                {lot && (
                  <a
                    href={directionsUrl(lot, o.loc, o.name)}
                    target="_blank"
                    rel="noreferrer"
                    className="press -ml-xxs inline-flex min-h-tap items-center gap-xxs self-start px-xxs text-caption text-accent"
                  >
                    <Navigation size={14} aria-hidden />
                    Directions from the lot
                    <span className="sr-only">(opens Google Maps in a new tab)</span>
                  </a>
                )}
              </span>
            </li>
          ))}
        </ol>

        {lot && (
          <div className="flex flex-col gap-xs md:sticky md:top-32 md:self-start">
            {loading ? (
              <Skeleton className="h-80 w-full rounded-lg" />
            ) : (
              <MapView lat={lot.lat} lon={lot.lon} label={`The lot, ${result.location}`} places={places} className="h-80 rounded-lg border border-hairline" />
            )}
            <p role="status" className="text-caption text-ink-secondary">
              {loading
                ? 'Finding the offices on the map.'
                : places.length > 0
                  ? 'The blue dot is the lot. Numbers match the list.'
                  : "We couldn't find these offices on OpenStreetMap. The directions links search for them by name."}
            </p>
          </div>
        )}
      </div>
    </Card>
  )
}

export function ReportBody({ report }: { report: Report }) {
  const { result, input } = report
  const grade = parseGrade(result.category)
  const insights = splitInsights(result.insights)
  const comps = result.comps ?? []
  const offices = result.offices ?? []

  return (
    <div>
      <Scores report={report} />
      <LotCost report={report} />

      <div className="gutter mx-auto flex max-w-reading flex-col gap-lg py-xxl sm:py-section">
        {comps.length > 0 && <PriceScale report={report} />}
        {result.geo_data && <Surroundings report={report} />}
        <NearbyPlaces report={report} />
        {insights.length > 0 && <Drivers insights={insights} />}
        <News report={report} />
        <Listings report={report} />

        {(offices.length > 0 || result.agency?.name) && <BeforeYouBuy report={report} />}

        <Card title="Values used">
          <dl className="grid gap-x-lg sm:grid-cols-2">
            {FACTORS.map((f) => (
              <Row key={f.key} label={f.label}>
                {input.data[f.key]}
                {f.unit ? ` ${f.unit}` : ' of 10'}
              </Row>
            ))}
          </dl>
        </Card>

        <Card title="How grades work" className="print:hidden">
          <ol className="flex flex-col gap-sm">
            {GRADE_ORDER.map((g) => {
              const info = gradeInfo(g)
              const current = info.grade === grade.grade
              return (
                <li
                  key={g}
                  aria-current={current ? 'true' : undefined}
                  className={`flex flex-col gap-xs rounded-lg p-sm sm:flex-row sm:items-center sm:gap-md ${current ? 'bg-surface-raised ring-2 ring-focus' : ''}`}
                >
                  <div className="sm:w-56 sm:shrink-0">
                    <GradeBadge grade={info} />
                  </div>
                  <p className="text-caption text-ink-secondary">
                    {current && <span className="font-semibold text-ink">This location. </span>}
                    {info.summary}
                  </p>
                </li>
              )
            })}
          </ol>
        </Card>
      </div>
    </div>
  )
}
