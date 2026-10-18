import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { CircleAlert, CircleCheck, CircleDashed, Clock, ExternalLink, FileUp, Fingerprint, LoaderCircle, ShieldCheck, ShieldX } from 'lucide-react'
import { errorCopy, listingsApi, type Credibility, type DocumentType, type Listing, type ListingDocument, type ListingEvent, type ListingSchema } from '../lib/api'
import { formatDate, formatPeso, type Tone } from '../lib/format'
import { fingerprint, openDocument, shortHash } from '../lib/listings'
import { Button } from './Button'
import { Ring } from './Grade'

const LEVEL_STYLE: Record<Credibility['level'], string> = {
  Strong: 'bg-positive-soft text-positive',
  Good: 'bg-positive-soft text-positive',
  Fair: 'bg-caution-soft text-caution',
  Low: 'bg-critical-soft text-critical',
}

const LEVEL_TONE: Record<Credibility['level'], Tone> = { Strong: 'positive', Good: 'positive', Fair: 'caution', Low: 'critical' }

/** Small "Credibility 55 · Fair" chip for listing cards */
export function CredibilityChip({ credibility }: { credibility: Credibility }) {
  return (
    <span className={`inline-flex items-center gap-xxs rounded-pill px-sm py-xxs text-caption font-semibold tabular-nums ${LEVEL_STYLE[credibility.level]}`}>
      <ShieldCheck size={14} strokeWidth={2.25} aria-hidden />
      Credibility {credibility.score} · {credibility.level}
    </span>
  )
}

const STATE_COPY: Record<Credibility['items'][number]['state'], { text: string; icon: typeof CircleCheck; tone: string }> = {
  verified: { text: 'Checked by SmartLand', icon: CircleCheck, tone: 'text-positive' },
  complete: { text: 'Given', icon: CircleCheck, tone: 'text-positive' },
  uploaded: { text: 'Uploaded, waiting for review', icon: Clock, tone: 'text-caution' },
  partial: { text: 'Partly given', icon: Clock, tone: 'text-caution' },
  rejected: { text: "Didn't pass review", icon: ShieldX, tone: 'text-critical' },
  missing: { text: 'Not given', icon: CircleDashed, tone: 'text-ink-secondary' },
}

/** The score, a ring, and what each part is worth */
export function CredibilityCard({ credibility }: { credibility: Credibility }) {
  return (
    <section aria-labelledby="credibility-title" className="flex flex-col gap-md rounded-lg border border-hairline bg-surface p-md sm:p-lg">
      <div className="flex flex-col gap-xxs">
        <h2 id="credibility-title" className="text-tagline font-semibold">
          Credibility score
        </h2>
        <p className="text-caption text-ink-secondary">
          How much of this listing has documents behind it, 0 to 100. Documents SmartLand checked with the issuing office count most. It isn’t a guarantee.
        </p>
      </div>
      <div className="flex flex-col items-center gap-md">
        <Ring label="Credibility score" value={credibility.score} max={100} status={{ tone: LEVEL_TONE[credibility.level], word: credibility.level }} />
        <ul className="flex w-full flex-col">
          {credibility.items.map((item) => {
            const s = STATE_COPY[item.state]
            return (
              <li key={item.key} className="flex items-start justify-between gap-sm border-b border-hairline py-xs last:border-b-0">
                <span className="flex items-start gap-xs">
                  <s.icon size={18} strokeWidth={2} className={`mt-0.5 shrink-0 ${s.tone}`} aria-hidden />
                  <span className="flex flex-col">
                    <span>{item.label}</span>
                    <span className="text-caption text-ink-secondary">{s.text}</span>
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-ink-secondary">
                  {item.points}
                  <span className="text-caption"> of {item.max}</span>
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

const DOC_STATUS: Record<ListingDocument['status'], { text: string; icon: typeof CircleCheck; tone: string }> = {
  verified: { text: 'Checked by SmartLand', icon: CircleCheck, tone: 'text-positive' },
  pending: { text: 'Waiting for review', icon: Clock, tone: 'text-caution' },
  rejected: { text: "Didn't pass review", icon: ShieldX, tone: 'text-critical' },
}

/** The documents behind a listing: kind, review status, and fingerprint for everyone; the file for the seller */
export function DocumentList({
  listing,
  schema,
  onChange,
}: {
  listing: Listing
  schema: ListingSchema
  onChange: (docs: ListingDocument[]) => void
}) {
  const [addType, setAddType] = useState<DocumentType>('title')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const docs = listing.documents

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const doc = await listingsApi.uploadDocument(listing.id, addType, file)
      onChange([...docs, doc])
    } catch (err) {
      const copy = errorCopy(err)
      setError((err as { detail?: string }).detail ?? copy.body)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="documents-title" className="flex flex-col gap-md rounded-lg border border-hairline bg-surface p-md sm:p-lg">
      <div className="flex flex-col gap-xxs">
        <h2 id="documents-title" className="text-tagline font-semibold">
          Documents
        </h2>
        <p className="text-caption text-ink-secondary">
          {listing.mine
            ? 'Only you and SmartLand reviewers can open these files. Buyers see each document’s kind, whether it was checked, and its fingerprint.'
            : 'The files are private to the seller and SmartLand reviewers. Ask the seller for copies, then check them below.'}
        </p>
      </div>
      {docs.length === 0 ? (
        <p className="text-ink-secondary">{listing.mine ? 'No documents yet. Add the land title first; it counts the most.' : 'The seller hasn’t added any documents.'}</p>
      ) : (
        <ul className="flex flex-col">
          {docs.map((d) => {
            const s = DOC_STATUS[d.status]
            return (
              <li key={d.id} className="flex flex-col gap-xxs border-b border-hairline py-sm last:border-b-0">
                <span className="flex flex-wrap items-center justify-between gap-x-sm gap-y-xxs">
                  <span className="font-semibold">{schema.documents[d.type]?.label ?? d.type}</span>
                  <span className={`inline-flex items-center gap-xxs text-caption font-semibold ${s.tone}`}>
                    <s.icon size={14} strokeWidth={2.25} aria-hidden />
                    {s.text}
                  </span>
                </span>
                <span className="inline-flex items-center gap-xxs text-caption text-ink-secondary">
                  <Fingerprint size={14} aria-hidden />
                  <span className="tabular-nums" title={d.sha256}>
                    {shortHash(d.sha256)}
                  </span>
                  <span aria-hidden>·</span>
                  Added {formatDate(d.uploaded_at)}
                </span>
                {listing.mine && (
                  <span className="flex flex-wrap items-center gap-x-sm text-caption text-ink-secondary">
                    {d.filename}
                    <button
                      type="button"
                      onClick={() => void openDocument(listing.id, d.id).catch(() => setError("We couldn't open that file. Try again."))}
                      className="press inline-flex min-h-tap items-center gap-xxs text-accent"
                    >
                      Open
                      <ExternalLink size={14} aria-hidden />
                    </button>
                  </span>
                )}
                {listing.mine && d.status === 'rejected' && d.review_note && (
                  <span className="text-caption text-critical">Reviewer’s note: {d.review_note}</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {listing.mine && (
        <div className="flex flex-col gap-xs border-t border-hairline pt-md">
          <label htmlFor="add-doc-type" className="font-semibold">
            Add a document
          </label>
          <div className="flex flex-col gap-xs sm:flex-row">
            <select
              id="add-doc-type"
              value={addType}
              onChange={(e) => setAddType(e.target.value as DocumentType)}
              className="h-tap min-w-0 flex-1 rounded-sm border border-hairline bg-surface px-md text-ink focus-visible:border-focus"
            >
              {(Object.keys(schema.documents) as DocumentType[]).map((t) => (
                <option key={t} value={t}>
                  {schema.documents[t].label}
                </option>
              ))}
            </select>
            <input ref={fileRef} type="file" accept={schema.document_types.join(',')} onChange={(e) => void onFile(e)} className="sr-only" tabIndex={-1} />
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              icon={busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : <FileUp size={18} aria-hidden />}
            >
              {busy ? 'Uploading' : 'Choose file'}
            </Button>
          </div>
          <p className="text-caption text-ink-secondary">
            PDF, JPG, PNG, or WebP, up to {schema.max_document_mb} MB. {schema.documents[addType]?.hint}
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="inline-flex items-center gap-xxs text-caption text-critical">
          <CircleAlert size={16} aria-hidden />
          {error}
        </p>
      )}
    </section>
  )
}

/** Lets a buyer check a copy the seller sent against the fingerprints on the listing */
export function CopyCheck({ documents, schema }: { documents: ListingDocument[]; schema: ListingSchema }) {
  const [result, setResult] = useState<{ name: string; match: ListingDocument | null } | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    const hash = await fingerprint(file)
    setResult({ name: file.name, match: documents.find((d) => d.sha256 === hash) ?? null })
    setBusy(false)
  }

  if (documents.length === 0) return null
  return (
    <section aria-labelledby="copy-title" className="flex flex-col gap-sm rounded-lg border border-hairline bg-surface p-md sm:p-lg">
      <h2 id="copy-title" className="inline-flex items-center gap-xs text-tagline font-semibold">
        <Fingerprint size={20} className="text-ink-secondary" aria-hidden />
        Check a copy you received
      </h2>
      <p className="text-caption text-ink-secondary">
        If the seller sent you a file, choose it here. Your browser works out its fingerprint and compares it with the documents on this listing. The file stays on
        your device.
      </p>
      <input ref={fileRef} type="file" onChange={(e) => void onFile(e)} className="sr-only" tabIndex={-1} />
      <Button
        variant="secondary"
        className="self-start"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        icon={busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : <Fingerprint size={18} aria-hidden />}
      >
        Choose a file to check
      </Button>
      {result && (
        <p role="status" className={`flex items-start gap-xs rounded-md p-sm ${result.match ? 'bg-positive-soft text-positive' : 'bg-caution-soft text-caution'}`}>
          {result.match ? <CircleCheck size={18} className="mt-0.5 shrink-0" aria-hidden /> : <CircleAlert size={18} className="mt-0.5 shrink-0" aria-hidden />}
          <span className="text-ink">
            {result.match ? (
              <>
                <span className="font-semibold">{result.name} matches.</span> It’s the same file as the {shortDocName(schema, result.match.type)} on this
                listing
                {result.match.status === 'verified' ? ', which SmartLand checked.' : result.match.status === 'pending' ? ', which isn’t reviewed yet.' : ', which didn’t pass review.'}
              </>
            ) : (
              <>
                <span className="font-semibold">{result.name} doesn’t match</span> any document on this listing. Even a rescan changes the fingerprint, so ask the
                seller to upload this exact file, or to send you the one they uploaded.
              </>
            )}
          </span>
        </p>
      )}
    </section>
  )
}

/** "land title", "tax declaration": the short name, for the middle of a sentence */
function shortDocName(schema: ListingSchema, type: DocumentType): string {
  const name = schema.scoring[type]?.label ?? schema.documents[type]?.label ?? type
  return name[0].toLowerCase() + name.slice(1)
}

const EVENT_COPY: Record<ListingEvent['kind'], (e: ListingEvent, docLabel: (t: string) => string) => string> = {
  listed: (e) => `Listed at ${formatPeso(Number(e.payload.price))}`,
  price: (e) => `Price changed from ${formatPeso(Number(e.payload.from))} to ${formatPeso(Number(e.payload.to))}`,
  status: (e) => (e.payload.status === 'sold' ? 'Marked as sold' : e.payload.status === 'active' ? 'Put back on sale' : 'Removed'),
  document: (e, label) => `${label(String(e.payload.type))} added`,
  review: (e, label) => `${label(String(e.payload.type))} ${e.payload.status === 'verified' ? 'checked by SmartLand' : 'didn’t pass review'}`,
}

/** Price history and the full fingerprinted record of every change */
export function ListingRecord({ listingId, schema, version }: { listingId: string; schema: ListingSchema; version: string }) {
  const [record, setRecord] = useState<{ key: string; intact: boolean; events: ListingEvent[] } | null>(null)
  const key = `${listingId}:${version}`

  useEffect(() => {
    const controller = new AbortController()
    listingsApi
      .record(listingId, controller.signal)
      .then((r) => setRecord({ key, ...r }))
      .catch(() => {})
    return () => controller.abort()
    // version changes whenever the listing does, so the record refreshes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  if (!record) return null
  const label = (t: string) => schema.documents[t as DocumentType]?.label ?? t
  const prices = record.events.filter((e) => e.kind === 'listed' || e.kind === 'price')

  return (
    <section aria-labelledby="record-title" className="flex flex-col gap-md rounded-lg border border-hairline bg-surface p-md sm:p-lg">
      <div className="flex flex-col gap-xxs">
        <h2 id="record-title" className="text-tagline font-semibold">
          Price history
        </h2>
        <p className="text-caption text-ink-secondary">Every asking price this listing has had. Changes can’t be hidden or backdated.</p>
      </div>
      <ol className="flex flex-col">
        {prices.map((e) => (
          <li key={e.seq} className="flex flex-wrap justify-between gap-x-sm border-b border-hairline py-xs tabular-nums last:border-b-0">
            <span>{EVENT_COPY[e.kind](e, label)}</span>
            <span className="text-caption text-ink-secondary">{formatDate(e.created_at)}</span>
          </li>
        ))}
      </ol>

      <details className="group flex flex-col gap-sm border-t border-hairline pt-md">
        <summary className="press inline-flex min-h-tap cursor-pointer list-none items-center gap-xs font-semibold text-accent">
          <Fingerprint size={18} aria-hidden />
          See the full record ({record.events.length} {record.events.length === 1 ? 'entry' : 'entries'})
        </summary>
        <div className="flex flex-col gap-sm pt-sm">
          <p className={`inline-flex items-start gap-xs text-caption ${record.intact ? 'text-positive' : 'text-critical'}`}>
            {record.intact ? <ShieldCheck size={16} className="mt-0.5 shrink-0" aria-hidden /> : <ShieldX size={16} className="mt-0.5 shrink-0" aria-hidden />}
            <span>
              {record.intact
                ? 'Record intact. Each entry’s fingerprint covers the entry before it, so changing any past entry would break every fingerprint after it.'
                : 'This record was changed after the fact. Treat this listing with care and contact SmartLand.'}
            </span>
          </p>
          <ol className="flex flex-col">
            {record.events.map((e) => (
              <li key={e.seq} className="flex flex-col gap-xxs border-b border-hairline py-xs last:border-b-0">
                <span className="flex flex-wrap justify-between gap-x-sm">
                  <span>
                    <span className="tabular-nums text-ink-secondary">{e.seq}. </span>
                    {EVENT_COPY[e.kind](e, label)}
                  </span>
                  <span className="text-caption text-ink-secondary">{formatDate(e.created_at)}</span>
                </span>
                <span className="text-fine-print tabular-nums text-ink-secondary" title={e.hash}>
                  Fingerprint {shortHash(e.hash)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </details>
    </section>
  )
}
