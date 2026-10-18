import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Plus } from 'lucide-react'
import { listingsApi, type ListingSearch } from '../lib/api'
import type { Report } from '../lib/reports'
import { CATEGORIES, nearParams, type Near } from '../lib/listings'
import { ButtonLink } from './Button'
import { ListingChecks } from './ListingChecks'
import { Card } from './ReportBody'

const RADIUS_KM = 25

/** Property for sale and rent near the lot, from listings posted on SmartLand */
export function Listings({ report }: { report: Report }) {
  const { result } = report
  const geo = result.geo_data
  const town = geo?.locality ?? geo?.name ?? result.location
  const near: Near | null =
    typeof geo?.lat === 'number' && typeof geo?.lon === 'number' ? { lat: geo.lat, lon: geo.lon, town, province: geo.province ?? null } : null
  const [found, setFound] = useState<ListingSearch | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!near) return
    const controller = new AbortController()
    listingsApi
      .near({ lat: near.lat, lon: near.lon, radius_km: RADIUS_KM }, controller.signal)
      .then(setFound)
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') setFailed(true)
      })
    return () => controller.abort()
    // The lot never changes for a report
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.id])

  if (!near) return null
  const total = found ? Object.values(found.counts).reduce((a, b) => a + (b ?? 0), 0) : 0

  return (
    <Card
      title="Property for sale and rent nearby"
      intro={`Listings posted on SmartLand within ${RADIUS_KM} km of the lot. Sellers post them directly, so check each one with the steps below.`}
    >
      <p role="status" className="text-caption text-ink-secondary">
        {failed
          ? "We couldn't load the counts. Open a category to try again."
          : !found
            ? 'Counting listings near the lot.'
            : total === 0
              ? `No listings within ${RADIUS_KM} km of ${town} yet.`
              : `${total} ${total === 1 ? 'listing' : 'listings'} within ${RADIUS_KM} km of ${town}.`}
      </p>
      <ul className="grid gap-sm xs:grid-cols-2 md:grid-cols-3">
        {CATEGORIES.map((c) => {
          const count = found?.counts[c.key] ?? 0
          return (
            <li key={c.key} className="flex">
              <Link
                to={`/listings/${c.slug}?${nearParams(near, RADIUS_KM)}`}
                className="press flex min-h-tap w-full items-center gap-sm rounded-lg border border-hairline p-md transition-colors hover:bg-surface-raised"
              >
                <c.icon size={22} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-semibold">{c.label}</span>
                  <span className="text-caption tabular-nums text-ink-secondary">
                    {!found ? (failed ? 'Open to see' : 'Counting') : count === 0 ? 'None listed yet' : `${count} listed`}
                  </span>
                </span>
                <ChevronRight size={18} className="shrink-0 text-ink-secondary" aria-hidden />
              </Link>
            </li>
          )
        })}
      </ul>
      <ButtonLink to={`/listings/new?${nearParams(near)}`} variant="secondary" className="self-start" icon={<Plus size={18} aria-hidden />}>
        Post a listing
      </ButtonLink>
      <ListingChecks />
    </Card>
  )
}
