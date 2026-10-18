import { useEffect, useMemo, useState } from 'react'
import {
  Car,
  CookingPot,
  Drumstick,
  ExternalLink,
  GraduationCap,
  Hamburger,
  Hospital,
  LoaderCircle,
  Monitor,
  Navigation,
  RotateCw,
  ShoppingBag,
  ShoppingCart,
  Store,
  TreePalm,
  Utensils,
  type LucideIcon,
} from 'lucide-react'
import { nearbyPlaces, type NearbyCategory, type NearbyKind } from '../lib/api'
import type { Report } from '../lib/reports'
import { Button } from './Button'
import { MapView } from './Map'
import type { MapPlace } from './LotMap'
import { Card } from './ReportBody'
import { Skeleton } from './States'

type Group = 'Everyday' | 'Food' | 'Getting around and fun'

// `search` is what Google Maps is asked for when the open map data is missing places
const KINDS: { kind: NearbyKind; label: string; one: string; search: string; icon: LucideIcon; group: Group }[] = [
  { kind: 'hospital', label: 'Hospitals', one: 'Hospital', search: 'hospital', icon: Hospital, group: 'Everyday' },
  { kind: 'school', label: 'Schools', one: 'School', search: 'school', icon: GraduationCap, group: 'Everyday' },
  { kind: 'supermarket', label: 'Supermarkets', one: 'Supermarket', search: 'supermarket', icon: ShoppingCart, group: 'Everyday' },
  { kind: 'mall', label: 'Malls', one: 'Mall', search: 'mall', icon: ShoppingBag, group: 'Everyday' },
  { kind: 'seven_eleven', label: '7-Eleven', one: '7-Eleven', search: '7-Eleven', icon: Store, group: 'Everyday' },
  { kind: 'restaurant', label: 'Carinderias and restaurants', one: 'Carinderia or restaurant', search: 'carinderia restaurant', icon: CookingPot, group: 'Food' },
  { kind: 'jollibee', label: 'Jollibee', one: 'Jollibee', search: 'Jollibee', icon: Utensils, group: 'Food' },
  { kind: 'mcdonalds', label: 'McDonald’s', one: 'McDonald’s', search: "McDonald's", icon: Hamburger, group: 'Food' },
  { kind: 'mang_inasal', label: 'Mang Inasal', one: 'Mang Inasal', search: 'Mang Inasal', icon: Drumstick, group: 'Food' },
  { kind: 'resort', label: 'Resorts', one: 'Resort', search: 'resort', icon: TreePalm, group: 'Getting around and fun' },
  { kind: 'car_rental', label: 'Car rentals', one: 'Car rental', search: 'car rental', icon: Car, group: 'Getting around and fun' },
  { kind: 'computer_shop', label: 'Computer shops', one: 'Computer shop', search: 'computer shop internet cafe', icon: Monitor, group: 'Getting around and fun' },
]
const GROUPS: Group[] = ['Everyday', 'Food', 'Getting around and fun']

type Found = Record<NearbyKind, NearbyCategory>

function directionsUrl(from: { lat: number; lon: number }, to: { lat: number; lon: number }) {
  return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lon}&destination=${to.lat},${to.lon}`
}

function googleSearchUrl(what: string, at: { lat: number; lon: number }) {
  return `https://www.google.com/maps/search/${encodeURIComponent(what)}/@${at.lat},${at.lon},14z`
}

const km = (d: number) => (d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`)

/** Hospitals, supermarkets, malls, and the chains people ask about, nearest first, on a map */
export function NearbyPlaces({ report }: { report: Report }) {
  const geo = report.result.geo_data
  const lot = typeof geo?.lat === 'number' && typeof geo?.lon === 'number' ? { lat: geo.lat, lon: geo.lon } : null
  const [found, setFound] = useState<Found | null>(null)
  // Showing the quick answer while OpenStreetMap finishes in the background
  const [partial, setPartial] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [picked, setPicked] = useState<NearbyKind | null>(null)

  useEffect(() => {
    if (!lot) return
    const controller = new AbortController()
    let timer = 0
    let shown = false
    const load = (tries: number) =>
      nearbyPlaces(lot.lat, lot.lon, controller.signal)
        .then((r) => {
          shown = true
          setFound(r.categories)
          setPartial(r.partial && tries > 0)
          // Ask again until the full answer is in; the server keeps working on it
          if (r.partial && tries > 0) timer = window.setTimeout(() => void load(tries - 1), 6000)
        })
        .catch((err) => {
          if ((err as Error).name === 'AbortError') return
          // Keep a quick answer on screen if the follow-up fails
          setPartial(false)
          if (!shown) setFailed(true)
        })
    void load(4)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
    // The lot never changes for a report
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.id, attempt])

  // Until someone picks a tab, show the first kind that has anything nearby
  const kind = picked ?? KINDS.find((k) => (found?.[k.kind]?.count ?? 0) > 0)?.kind ?? 'hospital'
  const current = found?.[kind]
  const info = KINDS.find((k) => k.kind === kind)!
  // None within the radius: list the nearest mapped one instead of a bare 0
  const outside = current && current.count === 0 ? (current.nearest ?? null) : null
  const rows = useMemo(() => (current ? (current.count > 0 ? current.places : current.nearest ? [current.nearest] : []) : []), [current])

  const places = useMemo<MapPlace[]>(
    () => rows.map((p, i) => ({ n: String(i + 1), lat: p.lat, lon: p.lon, label: p.name ?? info.one })),
    [rows, info.one],
  )

  if (!lot) return null

  const retry = () => {
    setFailed(false)
    setFound(null)
    setAttempt((n) => n + 1)
  }

  return (
    <Card title="What’s nearby" intro="Schools, hospitals, shops, food, and more around the lot, from OpenStreetMap and Overture Maps. Distances are straight-line.">
      {failed ? (
        <div className="flex flex-col items-start gap-sm">
          <p className="text-ink-secondary">We couldn’t load nearby places. The map data service is busy. Try again in a minute.</p>
          <Button variant="secondary" onClick={retry} icon={<RotateCw size={18} aria-hidden />}>
            Try again
          </Button>
        </div>
      ) : !found ? (
        <div aria-busy className="flex flex-col gap-sm">
          <p role="status" className="text-caption text-ink-secondary">
            Finding places near the lot. This usually takes a few seconds.
          </p>
          <div className="flex flex-wrap gap-xs">
            {KINDS.map((k) => (
              <Skeleton key={k.kind} className="h-11 w-28 rounded-pill" />
            ))}
          </div>
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-sm print:hidden">
            {GROUPS.map((g) => (
              <div key={g} role="group" aria-label={g} className="flex flex-col gap-xs">
                <p className="text-caption font-semibold text-ink-secondary">{g}</p>
                <div className="flex flex-wrap gap-xs">
                  {KINDS.filter((x) => x.group === g).map(({ kind: k, label, icon: Icon }) => {
                    const on = k === kind
                    const cat = found[k]
                    const count = cat?.count ?? 0
                    const far = count === 0 ? cat?.nearest : null
                    return (
                      <button
                        key={k}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPicked(k)}
                        className={`press inline-flex min-h-tap items-center gap-xs rounded-pill bg-surface px-md text-ink ${on ? 'border-2 border-focus font-semibold' : 'border border-hairline'}`}
                      >
                        <Icon size={18} strokeWidth={1.75} className="text-ink-secondary" aria-hidden />
                        {label}
                        {/* A count when there are some nearby, otherwise how far the nearest one is */}
                        <span className="font-regular tabular-nums text-ink-secondary">
                          {far ? (
                            <>
                              <span className="sr-only">none nearby, nearest </span>
                              {km(far.distance_km)}
                            </>
                          ) : (
                            count
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {partial && (
            <p role="status" className="inline-flex items-center gap-xs text-caption text-ink-secondary">
              <LoaderCircle size={14} className="animate-spin" aria-hidden />
              Adding places from OpenStreetMap. The counts may still go up.
            </p>
          )}

          <div className="grid gap-xl md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div className="flex flex-col gap-sm" aria-live="polite">
              <h3 className="font-semibold">
                {current && current.count > 0
                  ? `${current.count} ${current.count === 1 ? info.one : info.label} within ${current.radius_km} km`
                  : `No ${info.label} within ${current?.radius_km ?? 5} km`}
              </h3>
              {outside && (
                <p className="text-caption text-ink-secondary">
                  The nearest one on the map data is {km(outside.distance_km)} from the lot.
                </p>
              )}
              {rows.length > 0 ? (
                <ol className="flex flex-col">
                  {rows.map((p, i) => (
                    <li key={`${p.lat},${p.lon}`} className="flex items-start gap-sm border-b border-hairline py-sm last:border-b-0">
                      <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-pill bg-ink text-caption font-semibold tabular-nums text-canvas">
                        {i + 1}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="font-semibold">{p.name ?? info.one}</span>
                        {p.address && <span className="text-caption text-ink-secondary">{p.address}</span>}
                        <a
                          href={directionsUrl(lot, p)}
                          target="_blank"
                          rel="noreferrer"
                          className="press -ml-xxs inline-flex min-h-tap items-center gap-xxs self-start px-xxs text-caption text-accent print:hidden"
                        >
                          <Navigation size={14} aria-hidden />
                          Directions from the lot
                          <span className="sr-only">(opens Google Maps in a new tab)</span>
                        </a>
                      </span>
                      <span className="shrink-0 pt-xxs tabular-nums text-ink-secondary">{km(p.distance_km)}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-ink-secondary">
                  None in the map data within {current?.search_km ?? current?.radius_km ?? 5} km of the lot.
                </p>
              )}
              {current && current.count > current.places.length && (
                <p className="text-caption text-ink-secondary">Showing the nearest {current.places.length}.</p>
              )}
              <div className="flex flex-col gap-xxs border-t border-hairline pt-sm print:hidden">
                <p className="text-caption text-ink-secondary">
                  Open map data misses some places, especially new ones and those outside big cities. Google Maps usually lists more.
                </p>
                <a
                  href={googleSearchUrl(info.search, lot)}
                  target="_blank"
                  rel="noreferrer"
                  className="press -ml-xxs inline-flex min-h-tap items-center gap-xxs self-start px-xxs text-caption text-accent"
                >
                  <ExternalLink size={14} aria-hidden />
                  Search Google Maps for {info.label} near the lot
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </div>
            </div>

            <div className="flex flex-col gap-xs md:sticky md:top-32 md:self-start">
              <MapView lat={lot.lat} lon={lot.lon} label={`The lot, ${report.result.location}`} places={places} className="h-80 rounded-lg border border-hairline" />
              <p className="text-caption text-ink-secondary">The blue dot is the lot. Numbers match the list.</p>
              <p className="text-fine-print text-ink-secondary">
                Places from OpenStreetMap contributors (ODbL) and the Overture Maps Foundation (CDLA Permissive 2.0).
              </p>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}
