import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ExternalLink, MapPinOff, Plus, RotateCw, Search, SearchX } from 'lucide-react'
import { ApiError, geocode, listingsApi, type ListingSearch } from '../lib/api'
import { CATEGORIES, RADII_KM, categoryBySlug, nearParams, portalSearchUrl, readNear } from '../lib/listings'
import { Button, ButtonLink } from '../components/Button'
import { ListingCard } from '../components/ListingCard'
import { ListingChecks } from '../components/ListingChecks'
import { MapView } from '../components/Map'
import type { MapPlace } from '../components/LotMap'
import { EmptyState, Skeleton } from '../components/States'
import { TextField } from '../components/Fields'

interface Result {
  key: string
  data: ListingSearch
  /** When nothing is in the circle: how many are within 50 km, so we can offer to widen */
  wider: number | null
}

/** Type a town to see what's listed around it, without running a price report first */
function TownSearch({ slug }: { slug: string }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault()
    const q = query.trim()
    if (q.length < 2) {
      setError('Enter a town, city, or barangay.')
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const place = await geocode(q)
      const town = place.locality || place.name
      navigate(`/listings${slug ? `/${slug}` : ''}?${nearParams({ lat: place.lat, lon: place.lon, town, province: place.province ?? null })}`)
    } catch (err) {
      setError(
        err instanceof ApiError && err.kind === 'not-found'
          ? 'We couldn’t find that place. Check the spelling, or add the province, such as “Lipa, Batangas”.'
          : 'We couldn’t look up that place right now. Try again in a moment.',
      )
      setBusy(false)
    }
  }

  return (
    <div className="gutter mx-auto flex max-w-form flex-col gap-lg py-xxl sm:py-section">
      <header className="flex flex-col gap-xs">
        <h1 className="text-display-md">Find listings by town</h1>
        <p className="text-ink-secondary">
          See land, houses, and buildings for sale or rent around any town, posted by owners and licensed brokers.
        </p>
      </header>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-sm">
        <TextField
          label="Town, city, or barangay"
          search
          placeholder="Lipa, Batangas"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          error={error}
        />
        <Button type="submit" disabled={busy} className="self-start" icon={<Search size={18} aria-hidden />}>
          {busy ? 'Finding the town' : 'Show listings'}
        </Button>
      </form>
      <p className="text-caption text-ink-secondary">
        Selling or renting out a property?{' '}
        <Link to="/listings/new" className="text-accent">
          Post a listing
        </Link>
      </p>
    </div>
  )
}

/** Listings near a place, of one kind (such as farm lots near Cabadbaran) or of every kind */
export function ListingsPage() {
  const { slug = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const category = slug ? categoryBySlug(slug) : undefined
  const near = readNear(params)
  const radius = RADII_KM.includes(Number(params.get('r'))) ? Number(params.get('r')) : 25
  const key = near && (category || !slug) ? `${category?.key ?? 'all'}:${near.lat},${near.lon}:${radius}` : ''
  const [result, setResult] = useState<Result | null>(null)
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!key || !near) return
    const controller = new AbortController()
    const q = { lat: near.lat, lon: near.lon, category: category?.key }
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

  if (slug && !category) {
    return (
      <EmptyState
        as="h1"
        icon={MapPinOff}
        title="This page doesn't exist"
        body="The link may be old or mistyped."
        action={<ButtonLink to="/listings">Find listings by town</ButtonLink>}
      />
    )
  }
  if (!near) return <TownSearch slug={slug} />

  const go = (opts: { slug?: string; radius?: number }) => {
    const nextSlug = opts.slug ?? slug
    navigate(`/listings${nextSlug ? `/${nextSlug}` : ''}?${nearParams(near, opts.radius ?? radius)}`, { replace: true })
  }
  const failed = failedKey === key && !ready
  const postUrl = category ? `/listings/new/${category.slug}?${nearParams(near)}` : `/listings/new?${nearParams(near)}`
  const postLabel = category ? `Post ${category.one}` : 'Post a listing'
  const kindLabel = category ? category.label.toLowerCase() : 'listings'

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
                {category ? category.label : 'Listings'} near {near.town}
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
              {postLabel}
            </ButtonLink>
          </div>

          <div role="group" aria-label="Kind of property" className="-mx-md flex gap-xs overflow-x-auto px-md pb-xxs sm:mx-0 sm:flex-wrap sm:px-0">
            <button
              type="button"
              aria-pressed={!category}
              onClick={() => go({ slug: '' })}
              className={`press inline-flex min-h-tap shrink-0 items-center gap-xs rounded-pill bg-surface px-md text-ink ${!category ? 'border-2 border-focus font-semibold' : 'border border-hairline'}`}
            >
              All kinds
            </button>
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
          <div role="group" aria-label="Distance" className="flex flex-wrap items-center gap-xs">
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
                  No {kindLabel} within {radius} km
                </p>
                <p className="text-ink-secondary">
                  {ready.wider
                    ? `${ready.wider} ${ready.wider === 1 ? 'is' : 'are'} listed within ${RADII_KM[RADII_KM.length - 1]} km.`
                    : `Nobody has posted ${category ? category.one : 'a listing'} near ${near.town} on SmartLand yet.`}
                </p>
              </div>
              <div className="flex flex-wrap gap-sm">
                {ready.wider ? (
                  <Button onClick={() => go({ radius: RADII_KM[RADII_KM.length - 1] })}>Show within {RADII_KM[RADII_KM.length - 1]} km</Button>
                ) : (
                  <ButtonLink to={postUrl} icon={<Plus size={18} aria-hidden />}>
                    {postLabel}
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

          {category && (
          <div className="flex flex-col gap-xs rounded-lg border border-hairline bg-surface p-md">
            <p className="font-semibold">Look on other sites too</p>
            <p className="text-caption text-ink-secondary">
              Other property sites list places that aren’t on SmartLand. We can’t show their listings here, so this opens a web search of those
              sites.
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
          )}
        </div>

        <div className="flex flex-col gap-lg lg:sticky lg:top-32 lg:self-start">
          <div className="flex flex-col gap-xs">
            <MapView lat={near.lat} lon={near.lon} label={`Searching around ${near.town}`} places={places} className="h-80 rounded-lg border border-hairline lg:h-112" />
            <p className="text-caption text-ink-secondary">
              The blue dot is where you searched{places.length > 0 ? '. Numbers match the list.' : '.'}{' '}
              <Link to="/listings" className="text-accent">
                Search another town
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
