import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, ExternalLink, FileQuestion, Phone, RotateCw, Search, Trash2, UserRound } from 'lucide-react'
import { ApiError, listingsApi, type Listing } from '../lib/api'
import { formatDate, formatPeso } from '../lib/format'
import { SELLER_LABEL, categoryByKey, formatArea, formatDetail, listingPrice, nearParams, pricePerSqm, useListingSchema } from '../lib/listings'
import { Button, ButtonLink } from '../components/Button'
import { ListingChecks } from '../components/ListingChecks'
import { MapView } from '../components/Map'
import { Banner, EmptyState, Skeleton } from '../components/States'
import { CopyCheck, CredibilityCard, DocumentList, ListingRecord } from '../components/Trust'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-tap items-center justify-between gap-md border-b border-hairline py-xs">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className="min-w-0 text-right tabular-nums">{children}</dd>
    </div>
  )
}

/** Seller's controls: mark sold or back on sale, or remove */
function OwnerControls({ listing, onChange }: { listing: Listing; onChange: (l: Listing | null) => void }) {
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [failed, setFailed] = useState(false)
  const [price, setPrice] = useState(String(listing.price))
  const newPrice = Number(price.replace(/,/g, ''))
  const priceChanged = Number.isFinite(newPrice) && newPrice > 0 && Math.round(newPrice) !== listing.price

  async function act(fn: () => Promise<Listing | null>) {
    setBusy(true)
    setFailed(false)
    try {
      onChange(await fn())
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="Your listing" className="flex flex-col gap-sm rounded-lg border border-hairline bg-surface p-md sm:p-lg">
      <p className="font-semibold">This is your listing</p>
      <p className="text-caption text-ink-secondary">
        {listing.status === 'sold' ? 'It shows as sold and no longer appears in searches.' : 'It appears in searches near this spot.'}
      </p>
      <div className="flex flex-wrap items-center gap-sm">
        {listing.status === 'sold' ? (
          <Button variant="secondary" disabled={busy} onClick={() => void act(() => listingsApi.setStatus(listing.id, 'active'))}>
            Put back on sale
          </Button>
        ) : (
          <Button variant="secondary" disabled={busy} onClick={() => void act(() => listingsApi.setStatus(listing.id, 'sold'))}>
            Mark as sold
          </Button>
        )}
        {confirm ? (
          <div role="group" aria-label="Confirm remove" className="flex flex-wrap items-center gap-sm">
            <span className="text-caption">Remove this listing for good?</span>
            <Button variant="plain" onClick={() => setConfirm(false)}>
              Keep
            </Button>
            <Button
              variant="secondary"
              className="border-critical text-critical"
              disabled={busy}
              onClick={() => void act(async () => (await listingsApi.remove(listing.id), null))}
            >
              Remove
            </Button>
          </div>
        ) : (
          <Button variant="plain" className="text-critical" icon={<Trash2 size={18} aria-hidden />} onClick={() => setConfirm(true)}>
            Remove listing
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-xs border-t border-hairline pt-sm">
        <label htmlFor="new-price" className="font-semibold">
          {categoryByKey(listing.category).rent ? 'Monthly rent (₱)' : 'Asking price (₱)'}
        </label>
        <div className="flex gap-xs">
          <input
            id="new-price"
            inputMode="numeric"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="h-tap min-w-0 flex-1 rounded-sm border border-hairline bg-surface px-md tabular-nums text-ink focus-visible:border-focus"
          />
          <Button variant="secondary" disabled={busy || !priceChanged} onClick={() => void act(() => listingsApi.setPrice(listing.id, Math.round(newPrice)))}>
            Change price
          </Button>
        </div>
        <p className="text-caption text-ink-secondary">The old price stays in the listing’s price history, where buyers can see it.</p>
      </div>
      {failed && <p className="text-caption text-critical">That didn't go through. Check your connection, then try again.</p>}
    </section>
  )
}

export function ListingPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const arrival = useLocation().state as { posted?: boolean; uploadFailed?: number } | null
  const posted = arrival?.posted ?? false
  const schema = useListingSchema()
  const [listing, setListing] = useState<{ id: string; data: Listing } | null>(null)
  const [failure, setFailure] = useState<{ id: string; err: unknown } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listingsApi
      .get(id, controller.signal)
      .then((data) => setListing({ id, data }))
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') setFailure({ id, err })
      })
    return () => controller.abort()
  }, [id, attempt])

  const l = listing?.id === id ? listing.data : null
  const err = failure?.id === id ? failure.err : null

  if (!l && err) {
    const gone = err instanceof ApiError && err.kind === 'not-found'
    return (
      <EmptyState
        as="h1"
        icon={FileQuestion}
        title={gone ? 'This listing is gone' : "We couldn't load this listing"}
        body={gone ? 'The seller removed it, or the link is mistyped.' : 'Check your connection, then try again.'}
        action={
          gone ? (
            <ButtonLink to="/check">Check a location</ButtonLink>
          ) : (
            <Button onClick={() => setAttempt((n) => n + 1)} icon={<RotateCw size={18} aria-hidden />}>
              Try again
            </Button>
          )
        }
      />
    )
  }

  if (!l) {
    return (
      <div aria-busy className="gutter mx-auto flex max-w-reading flex-col gap-md py-xxl">
        <p role="status" className="sr-only">
          Loading the listing.
        </p>
        <Skeleton className="h-6 w-1/4" />
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-80 w-full" />
      </div>
    )
  }

  const c = categoryByKey(l.category)
  const fields = schema?.categories[l.category]?.fields ?? []
  const version = `${l.updated_at}:${l.documents.map((d) => d.status).join(',')}`
  const refresh = () => setAttempt((n) => n + 1)
  const perSqm = pricePerSqm(l)
  const town = l.town ?? l.place.split(',')[0]
  const near = { lat: l.lat, lon: l.lon, town, province: l.province }

  return (
    <div>
      <div className="border-b border-hairline bg-canvas-alt">
        <div className="gutter mx-auto flex max-w-reading flex-col gap-md pb-xl pt-md">
          <button type="button" onClick={() => navigate(-1)} className="press -ml-xs inline-flex min-h-tap items-center gap-xxs self-start px-xs text-accent">
            <ChevronLeft size={20} aria-hidden />
            Back
          </button>
          {posted && (
            <Banner tone="positive" title="Your listing is live">
              People who check a location nearby will see it under {c.label.toLowerCase()}.
              {l.documents.length > 0 && ' A SmartLand reviewer will check your documents, usually within two working days.'}
            </Banner>
          )}
          {(arrival?.uploadFailed ?? 0) > 0 && (
            <Banner tone="caution" title={`${arrival!.uploadFailed} ${arrival!.uploadFailed === 1 ? 'document' : 'documents'} didn't upload`}>
              Add {arrival!.uploadFailed === 1 ? 'it' : 'them'} again under Documents below.
            </Banner>
          )}
          {l.status === 'sold' && (
            <Banner tone="caution" title="Marked as sold">
              The seller says this property is sold. It no longer shows in searches.
            </Banner>
          )}
          <div className="flex flex-col gap-xs">
            <p className="inline-flex items-center gap-xs text-caption text-ink-secondary">
              <c.icon size={16} aria-hidden />
              {c.label} · Posted {formatDate(l.created_at)}
            </p>
            <h1 className="text-display-md">{l.title}</h1>
            <p className="text-display-lg tabular-nums">{listingPrice(l)}</p>
            {perSqm && <p className="tabular-nums text-ink-secondary">{formatPeso(perSqm)} per sqm of lot</p>}
          </div>
        </div>
      </div>

      <div className="gutter mx-auto grid max-w-reading gap-lg py-xl md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-lg">
          <MapView lat={l.lat} lon={l.lon} label={l.title} className="h-72 rounded-lg border border-hairline sm:h-80" />
          <dl>
            <Row label="Where">
              <span className="block truncate" title={l.place}>
                {l.place}
              </span>
            </Row>
            {l.lot_sqm && <Row label="Lot area">{formatArea(l.lot_sqm)}</Row>}
            {l.floor_sqm && <Row label="Floor area">{formatArea(l.floor_sqm)}</Row>}
            {fields
              .filter((f) => l.details[f.key] !== undefined)
              .map((f) => (
                <Row key={f.key} label={f.label}>
                  {formatDetail(f, l.details[f.key])}
                </Row>
              ))}
            <Row label="Seller">{SELLER_LABEL[l.seller_type]}</Row>
            {l.prc_license && <Row label="PRC license">{l.prc_license}</Row>}
          </dl>
          {l.description && (
            <div className="flex flex-col gap-xs">
              <h2 className="text-tagline font-semibold">About this property</h2>
              <p className="whitespace-pre-line">{l.description}</p>
            </div>
          )}
          {schema && (
            <>
              <DocumentList listing={l} schema={schema} onChange={refresh} />
              {!l.mine && <CopyCheck documents={l.documents} schema={schema} />}
              <ListingRecord listingId={l.id} schema={schema} version={version} />
            </>
          )}
          <div className="flex flex-col gap-xs rounded-lg border border-hairline bg-surface p-md sm:p-lg">
            <p className="font-semibold">Is the price fair?</p>
            <p className="text-caption text-ink-secondary">
              Get SmartLand’s estimate for this exact spot, with nearby reference prices and the offices to visit.
            </p>
            <ButtonLink to={`/check?lat=${l.lat.toFixed(6)}&lon=${l.lon.toFixed(6)}`} variant="secondary" className="self-start" icon={<Search size={18} aria-hidden />}>
              Check this spot
            </ButtonLink>
          </div>
        </div>

        <div className="flex flex-col gap-lg">
          {l.mine ? (
            <OwnerControls
              listing={l}
              onChange={(next) => (next ? setListing({ id, data: next }) : navigate('/listings/mine', { replace: true }))}
            />
          ) : (
            <section aria-label="Contact the seller" className="flex flex-col gap-sm rounded-lg border border-hairline bg-surface p-md sm:p-lg">
              <p className="inline-flex items-center gap-xs font-semibold">
                <UserRound size={18} className="text-ink-secondary" aria-hidden />
                {l.contact_name}
              </p>
              <p className="text-caption text-ink-secondary">{SELLER_LABEL[l.seller_type]}</p>
              {l.contact_phone && l.status === 'active' && (
                <a href={`tel:${l.contact_phone.replace(/[^\d+]/g, '')}`} className="press inline-flex min-h-tap items-center justify-center gap-xs rounded-pill bg-accent-fill px-btn-x text-on-accent">
                  <Phone size={18} aria-hidden />
                  Call {l.contact_phone}
                </a>
              )}
              {l.seller_type === 'broker' && l.prc_license && (
                <a
                  href="https://online.prc.gov.ph/Verification"
                  target="_blank"
                  rel="noreferrer"
                  className="press -ml-xxs inline-flex min-h-tap items-center gap-xxs self-start px-xxs text-caption text-accent"
                >
                  Look up PRC license {l.prc_license}
                  <ExternalLink size={14} aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              )}
              <p className="text-caption text-ink-secondary">
                SmartLand doesn’t check sellers or licenses. Never send money before you’ve seen the property and the title.
              </p>
            </section>
          )}
          <CredibilityCard credibility={l.credibility} />
          <ButtonLink to={`/listings/${c.slug}?${nearParams(near, 25)}`} variant="plain" className="-ml-xs self-start">
            More {c.label.toLowerCase()} near {town}
          </ButtonLink>
          <div className="rounded-lg border border-hairline bg-surface p-md sm:p-lg">
            <ListingChecks />
          </div>
        </div>
      </div>
    </div>
  )
}
