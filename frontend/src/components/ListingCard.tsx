import { Link } from 'react-router-dom'
import { MapPin } from 'lucide-react'
import type { Listing } from '../lib/api'
import { formatPeso } from '../lib/format'
import { SELLER_LABEL, categoryByKey, formatArea, km, listingPrice, pricePerSqm } from '../lib/listings'
import { CredibilityChip } from './Trust'

/** One listing in a list. `n` matches its marker on the map. */
export function ListingCard({ listing, n }: { listing: Listing; n?: number }) {
  const c = categoryByKey(listing.category)
  const perSqm = pricePerSqm(listing)
  return (
    <Link
      to={`/listing/${listing.id}`}
      className="press flex gap-sm rounded-lg border border-hairline bg-surface p-md transition-colors hover:bg-surface-raised"
    >
      {n !== undefined ? (
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-pill bg-ink text-caption font-semibold tabular-nums text-canvas">
          {n}
        </span>
      ) : (
        <c.icon size={22} strokeWidth={1.75} className="mt-xxs shrink-0 text-ink-secondary" aria-hidden />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-xxs">
        <span className="flex flex-wrap items-baseline justify-between gap-x-sm">
          <span className="text-tagline font-semibold tabular-nums">{listingPrice(listing)}</span>
          {listing.distance_km !== undefined && <span className="text-caption tabular-nums text-ink-secondary">{km(listing.distance_km)} away</span>}
        </span>
        <span className="font-semibold">{listing.title}</span>
        <span className="text-caption tabular-nums text-ink-secondary">
          {[listing.lot_sqm && `Lot ${formatArea(listing.lot_sqm)}`, listing.floor_sqm && `Floor ${formatArea(listing.floor_sqm)}`, perSqm && `${formatPeso(perSqm)} per sqm`]
            .filter(Boolean)
            .join(' · ')}
        </span>
        <span className="inline-flex items-center gap-xxs text-caption text-ink-secondary">
          <MapPin size={14} aria-hidden />
          <span className="truncate">{listing.place}</span>
        </span>
        <span className="text-caption text-ink-secondary">
          {SELLER_LABEL[listing.seller_type]}
          {listing.seller_type === 'broker' && listing.prc_license && ` · PRC ${listing.prc_license}`}
          {listing.status === 'sold' && <span className="font-semibold text-ink"> · Sold</span>}
        </span>
        <span className="pt-xxs">
          <CredibilityChip credibility={listing.credibility} />
        </span>
      </span>
    </Link>
  )
}
