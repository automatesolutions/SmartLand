import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ExternalLink, MapPinOff, Plus, RotateCw, SearchX } from 'lucide-react'
import { listingsApi, type ListingSearch } from '../lib/api'
import { CATEGORIES, RADII_KM, categoryBySlug, nearParams, portalSearchUrl, readNear } from '../lib/listings'
import { Button, ButtonLink } from '../components/Button'
import { ListingCard } from '../components/ListingCard'
import { ListingChecks } from '../components/ListingChecks'
import { MapView } from '../components/Map'
import type { MapPlace } from '../components/LotMap'
import { EmptyState, Skeleton } from '../components/States'

interface Result {
  key: string
  data: ListingSearch
  /** When nothing is in the circle: how many are within 50 km, so we can offer to widen */
  wider: number | null
}

/** One category of listings near a place, such as farm lots near Cabadbaran */
export function ListingsPage() {
  const { slug = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const category = categoryBySlug(slug)
  const near = readNear(params)
  const radius = RADII_KM.includes(Number(params.get('r'))) ? Number(params.get('r')) : 25
  const key = near && category ? `${category.key}:${near.lat},${near.lon}:${radius}` : ''
  const [result, setResult] = useState<Result | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!key || !near || !category) return
    const controller = new AbortController()
    const q = { lat: near.lat, lon: near.lon, category: category.key }
    listingsApi
      .near({ ...q, radius_km: radius }, controller.signal)
      .then(async (data) => {
        const widest = RADII_KM[RADII_KM.length - 1]
        const wider = data.count === 0 && radius < widest ? (await listingsApi.near({ ...q, radius_km: widest }, controller.signal)).count : null
        setResult({ key, data, wider })
      })
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') setFailedKey(key)
      })
    return () => controller.abort()
    // key covers the category, the point, and the radius
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt])

  const ready = result?.key === key ? result : null
  const places = useMemo<MapPlace[]>(
    () => (ready?.data.listings ?? []).map((l, i) => ({ n: String(i + 1), lat: l.lat, lon: l.lon, label: l.title })),
    [ready],
  )

  if (!category || !near) {
    return (
      <EmptyState
        as="h1"
        icon={MapPinOff}
        title={category ? 'Pick a place first' : "This page doesn't exist"}
        body={category ? 'Listings are shown around a location. Check a location, then open listings from its report.' : 'The link may be old or mistyped.'}
        action={<ButtonLink to="/check">Check a location</ButtonLink>}
      />
    )
  }

  const go = (opts: { slug?: string; radius?: number }) =>
    navigate(`/listings/${opts.slug ?? slug}?${nearParams(near, opts.radius ?? radius)}`, { replace: true })
  const failed = failedKey === key && !ready
  const postUrl = `/listings/new/${category.slug}?${nearParams(near)}`

  return (
    <div>
      <div className="border-b border-hairline bg-canvas-alt">
        <div className="gutter mx-auto flex max-w-grid flex-col gap-md pb-lg pt-md">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="press -ml-xs inline-flex min-h-tap items-center gap-xxs self-start px-xs text-accent"
          >
            <ChevronLeft size={20} aria-hidden />
            Back
          </button>
          <div className="flex flex-col gap-xs sm:flex-row sm:items-end sm:justify-between">
            <div className="flex flex-col gap-xxs">
              <h1 className="text-display-md">
                {category.label} near {near.town}
              </h1>
              <p role="status" className="tabular-nums text-ink-secondary">
                {ready
                  ? ready.data.count === 0
                    ? `None listed within ${radius} km yet.`
                    : `${ready.data.count} listed within ${radius} km, nearest first.`
                  : failed
                    ? "We couldn't load listings."
                    : 'Finding listings.'}
              </p>
            </div>
            <ButtonLink to={postUrl} className="self-start sm:self-auto" icon={<Plus size={18} aria-hidden />}>
              Post {category.one}
            </ButtonLink>
          </div>

          <div role="group" aria-label="Kind of property" className="-mx-md flex gap-xs overflow-x-auto px-md pb-xxs sm:mx-0 sm:flex-wrap sm:px-0">
            {CATEGORIES.map((c) => {
              const on = c.slug === slug
              return (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => go({ slug: c.slug })}
                  className={`press inline-flex min-h-tap shrink-0 items-center gap-xs rounded-pill bg-surface px-md text-ink ${on ? 'border-2 border-focus font-semibold' : 'border border-hairline'}`}
                >
                  <c.icon size={18} strokeWidth={1.75} className="text-ink-secondary" aria-hidden />
                  {c.label}
                </button>
              )
            })}
          </div>
          <div role="group" aria-label="Distance from the lot" className="flex flex-wrap items-center gap-xs">
            <span className="text-caption text-ink-secondary">Within</span>
            {RADII_KM.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={r === radius}
                onClick={() => go({ radius: r })}
                className={`press min-h-tap rounded-pill bg-surface px-md tabular-nums text-ink ${r === radius ? 'border-2 border-focus font-semibold' : 'border border-hairline'}`}
              >
                {r} km
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="gutter mx-auto grid max-w-grid gap-xl py-xl lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-sm">
          {failed ? (
            <div className="flex flex-col items-start gap-sm rounded-lg border border-hairline bg-surface p-lg">
              <p className="font-semibold">We couldn't load listings</p>
              <p className="text-ink-secondary">Check your connection, then try again.</p>
              <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)} icon={<RotateCw size={18} aria-hidden />}>
                Try again
              </Button>
            </div>
          ) : !ready ? (
            <div aria-hidden className="flex flex-col gap-sm">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-36 w-full rounded-lg" />
              ))}
            </div>
          ) : ready.data.count === 0 ? (
            <div className="flex flex-col items-start gap-md rounded-lg border border-hairline bg-surface p-lg">
              <SearchX size={28} strokeWidth={1.75} className="text-ink-secondary" aria-hidden />
              <div className="flex flex-col gap-xxs">
                <p className="text-tagline font-semibold">
                  No {category.label.toLowerCase()} within {radius} km
                </p>
                <p className="text-ink-secondary">
                  {ready.wider
                    ? `${ready.wider} ${ready.wider === 1 ? 'is' : 'are'} listed within ${RADII_KM[RADII_KM.length - 1]} km.`
                    : `Nobody has posted ${category.one} near ${near.town} on SmartLand yet.`}
                </p>
              </div>
              <div className="flex flex-wrap gap-sm">
                {ready.wider ? (
                  <Button onClick={() => go({ radius: RADII_KM[RADII_KM.length - 1] })}>Show within {RADII_KM[RADII_KM.length - 1]} km</Button>
                ) : (
                  <ButtonLink to={postUrl} icon={<Plus size={18} aria-hidden />}>
                    Post {category.one}
                  </ButtonLink>
                )}
              </div>
            </div>
          ) : (
            <ol className="flex flex-col gap-sm">
              {ready.data.listings.map((l, i) => (
                <li key={l.id}>
                  <ListingCard listing={l} n={i + 1} />
                </li>
              ))}
            </ol>
          )}

          <div className="flex flex-col gap-xs rounded-lg border border-hairline bg-surface p-md">
            <p className="font-semibold">Look on other sites too</p>
            <p className="text-caption text-ink-secondary">
              Lamudi, Dot Property, and Rentpad list properties that aren’t on SmartLand. We can’t show their listings here, so this opens a search on
              their sites.
            </p>
            <a
              href={portalSearchUrl(category, near.town, near.province)}
              target="_blank"
              rel="noreferrer"
              className="press -ml-xxs inline-flex min-h-tap items-center gap-xxs self-start px-xxs text-accent"
            >
              Search other sites for {category.label.toLowerCase()} near {near.town}
              <ExternalLink size={16} aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
        </div>

        <div className="flex flex-col gap-lg lg:sticky lg:top-32 lg:self-start">
          <div className="flex flex-col gap-xs">
            <MapView lat={near.lat} lon={near.lon} label={`The lot near ${near.town}`} places={places} className="h-80 rounded-lg border border-hairline lg:h-112" />
            <p className="text-caption text-ink-secondary">
              The blue dot is the lot{places.length > 0 ? '. Numbers match the list.' : '.'}{' '}
              <Link to="/check" className="text-accent">
                Check another location
              </Link>
            </p>
          </div>
          <div className="rounded-lg border border-hairline bg-surface p-md sm:p-lg">
            <ListingChecks />
          </div>
        </div>
      </div>
    </div>
  )
}
