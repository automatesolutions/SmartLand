import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CircleCheck, ExternalLink, Fingerprint, Inbox, LoaderCircle, RotateCw, ShieldX, UserRound } from 'lucide-react'
import { reviewApi, type ReviewItem } from '../lib/api'
import { useUser } from '../lib/auth'
import { formatDate } from '../lib/format'
import { categoryByKey, openDocument, shortHash, useListingSchema } from '../lib/listings'
import { Button, ButtonLink } from '../components/Button'
import { EmptyState, Skeleton } from '../components/States'

type Tab = 'pending' | 'verified' | 'rejected'
const TABS: { key: Tab; label: string }[] = [
  { key: 'pending', label: 'Waiting' },
  { key: 'verified', label: 'Checked' },
  { key: 'rejected', label: 'Rejected' },
]

// What a reviewer confirms with the issuing office before marking a document checked
const HOW_TO_CHECK: Record<string, string> = {
  title: 'Get a certified true copy from the Registry of Deeds (or LRA eSerbisyo). The title number, owner, area, and technical description must match, with no liens hidden.',
  rights: 'For a CLOA, confirm with the DAR provincial office. For a deed of sale, check the notary’s register and that the seller on it owned the land.',
  tax_declaration: 'Call or visit the city or municipal assessor. The tax declaration number, owner, and assessed value must match.',
  tax_clearance: 'Confirm with the treasurer’s office that the real property tax is paid up to the current year.',
  survey_plan: 'Check the lot plan’s approval with the DENR land management office and that it matches the title’s technical description.',
  other: 'Confirm the document with whoever issued it.',
}

function ReviewCard({ item, onDone }: { item: ReviewItem; onDone: () => void }) {
  const schema = useListingSchema()
  const [note, setNote] = useState(item.review_note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function decide(status: 'verified' | 'rejected') {
    if (status === 'rejected' && note.trim().length < 5) {
      setError('Say why it didn’t pass, so the seller can fix it.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await reviewApi.review(item.id, status, note.trim())
      onDone()
    } catch {
      setError("That didn't go through. Try again.")
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-col gap-sm rounded-lg border border-hairline bg-surface p-md sm:p-lg">
      <div className="flex flex-wrap items-start justify-between gap-sm">
        <div className="flex min-w-0 flex-col">
          <p className="text-tagline font-semibold">{schema?.documents[item.type]?.label ?? item.type}</p>
          <Link to={`/listing/${item.listing_id}`} className="text-accent">
            {item.listing_title}
          </Link>
          <p className="text-caption text-ink-secondary">
            {categoryByKey(item.listing_category)?.label} · {item.listing_place}
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={() => void openDocument(item.listing_id, item.id).catch(() => setError("We couldn't open the file."))}
          iconAfter={<ExternalLink size={16} aria-hidden />}
        >
          Open file
        </Button>
      </div>
      <p className="inline-flex flex-wrap items-center gap-xxs text-caption text-ink-secondary">
        {item.filename} · {(item.size / 1024 / 1024).toFixed(1)} MB · uploaded {formatDate(item.uploaded_at)} ·
        <Fingerprint size={14} aria-hidden />
        <span className="tabular-nums" title={item.sha256}>
          {shortHash(item.sha256)}
        </span>
      </p>
      <p className="rounded-md bg-surface-raised p-sm text-caption">
        <span className="font-semibold">How to check: </span>
        {HOW_TO_CHECK[item.type]}
      </p>
      {item.status === 'pending' ? (
        <>
          <label className="flex flex-col gap-xs">
            <span className="font-semibold">Note</span>
            <span className="text-caption text-ink-secondary">Shown to the seller. Required when you reject a document.</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              className="min-h-20 resize-y rounded-sm border border-hairline bg-surface px-md py-sm text-ink focus-visible:border-focus"
            />
          </label>
          <div className="flex flex-wrap gap-sm">
            <Button disabled={busy} onClick={() => void decide('verified')} icon={busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : <CircleCheck size={18} aria-hidden />}>
              Mark as checked
            </Button>
            <Button variant="secondary" className="border-critical text-critical" disabled={busy} onClick={() => void decide('rejected')} icon={<ShieldX size={18} aria-hidden />}>
              Reject
            </Button>
          </div>
        </>
      ) : (
        item.review_note && <p className="text-caption text-ink-secondary">Note: {item.review_note}</p>
      )}
      {error && (
        <p role="alert" className="text-caption text-critical">
          {error}
        </p>
      )}
    </li>
  )
}

/** Where reviewers check the documents sellers upload against the issuing offices */
export function ReviewsPage() {
  const user = useUser()
  const { pathname } = useLocation()
  const [tab, setTab] = useState<Tab>('pending')
  const [items, setItems] = useState<{ tab: Tab; list: ReviewItem[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!user?.is_admin) return
    let live = true
    reviewApi
      .queue(tab)
      .then((list) => live && setItems({ tab, list }))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [user?.is_admin, tab, attempt])

  if (!user) {
    return (
      <EmptyState
        as="h1"
        icon={UserRound}
        title="Sign in to review documents"
        body="Reviews are for SmartLand reviewers."
        action={
          <ButtonLink to="/account" state={{ from: pathname }}>
            Sign in
          </ButtonLink>
        }
      />
    )
  }
  if (!user.is_admin) {
    return <EmptyState as="h1" icon={ShieldX} title="This page is for reviewers" body="Ask a SmartLand admin to add your email to ADMIN_EMAILS." action={<ButtonLink to="/">Go to the home page</ButtonLink>} />
  }

  const list = items?.tab === tab ? items.list : null
  return (
    <div className="gutter mx-auto flex max-w-reading flex-col gap-lg py-xxl sm:py-section">
      <header className="flex flex-col gap-xs">
        <h1 className="text-display-md">Document reviews</h1>
        <p className="text-ink-secondary">
          Check each document with the office that issued it before you mark it checked. Your decision goes on the listing’s public record.
        </p>
      </header>
      <div role="group" aria-label="Show" className="flex flex-wrap gap-xs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`press min-h-tap rounded-pill bg-surface px-md text-ink ${tab === t.key ? 'border-2 border-focus font-semibold' : 'border border-hairline'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {failed ? (
        <div className="flex flex-col items-start gap-sm rounded-lg border border-hairline bg-surface p-lg">
          <p className="font-semibold">We couldn't load the documents</p>
          <Button
            variant="secondary"
            onClick={() => {
              setFailed(false)
              setAttempt((n) => n + 1)
            }}
            icon={<RotateCw size={18} aria-hidden />}
          >
            Try again
          </Button>
        </div>
      ) : !list ? (
        <div aria-hidden className="flex flex-col gap-sm">
          <Skeleton className="h-48 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={Inbox} title={tab === 'pending' ? 'Nothing to review' : 'None yet'} body={tab === 'pending' ? 'New documents show up here as sellers add them.' : 'Documents you review show up here.'} />
      ) : (
        <ul className="flex flex-col gap-md">
          {list.map((item) => (
            <ReviewCard key={item.id} item={item} onDone={() => setAttempt((n) => n + 1)} />
          ))}
        </ul>
      )}
    </div>
  )
}
