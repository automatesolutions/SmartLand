import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { LoaderCircle, Video, VideoOff } from 'lucide-react'
import { ApiError, callsApi, type CallPass, type TourInfo } from '../lib/api'
import { Button } from '../components/Button'
import { Call, type LeaveReason } from '../components/Call'
import { TextField } from '../components/Fields'
import { EmptyState, Skeleton } from '../components/States'

/** /tour/:token: a buyer joins a seller's live video tour from the link the seller sent. No account needed. */
export function TourPage() {
  const { token = '' } = useParams()
  const [info, setInfo] = useState<{ token: string; data: TourInfo } | null>(null)
  const [missing, setMissing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pass, setPass] = useState<CallPass | null>(null)
  const [after, setAfter] = useState<LeaveReason | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    callsApi
      .tourInfo(token, controller.signal)
      .then((data) => setInfo({ token, data }))
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') setMissing(token)
      })
    return () => controller.abort()
  }, [token, after])

  const tour = info?.token === token ? info.data : null

  if (missing === token && !tour) {
    return (
      <EmptyState
        as="h1"
        icon={VideoOff}
        title="This tour link doesn’t work"
        body="It may have been replaced by a newer link. Ask the seller to send it again."
        action={<Link to="/listings" className="text-accent">Find listings</Link>}
      />
    )
  }

  if (!tour) {
    return (
      <div aria-busy className="gutter mx-auto flex max-w-form flex-col gap-md py-xxl">
        <p role="status" className="sr-only">
          Loading the tour.
        </p>
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    )
  }

  const listingLink = tour.listing && (
    <Link to={`/listing/${tour.listing.id}`} className="text-accent">
      See the listing
    </Link>
  )

  if (tour.state === 'ended' || !tour.enabled) {
    return (
      <EmptyState
        as="h1"
        icon={VideoOff}
        title="This tour has ended"
        body={`Message ${tour.host} if you’d like another tour.`}
        action={listingLink ?? undefined}
      />
    )
  }

  async function join(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !consent) return
    setBusy(true)
    setError(null)
    try {
      setPass(await callsApi.joinTour(token, name.trim()))
      setAfter(null)
    } catch (err) {
      setError(err instanceof ApiError && err.detail ? err.detail : 'You couldn’t join. Check your connection, then try again.')
    } finally {
      setBusy(false)
    }
  }

  function closed(reason: LeaveReason) {
    if (pass) void callsApi.leaveTour(token, pass.identity).catch(() => {})
    setPass(null)
    setAfter(reason)
  }

  return (
    <div className="gutter mx-auto flex max-w-form flex-col gap-lg py-xxl">
      <header className="flex flex-col gap-xs">
        <p className="inline-flex items-center gap-xs text-caption font-semibold text-positive">
          <Video size={16} aria-hidden />
          Live video tour
        </p>
        <h1 className="text-display-md">{tour.listing ? tour.listing.title : 'Property tour'}</h1>
        <p className="text-ink-secondary">
          With {tour.host}. {tour.people > 0 ? `${tour.people === 1 ? '1 person is' : `${tour.people} people are`} in the tour now.` : 'You can join now and wait for them.'}
        </p>
      </header>

      {after && after !== 'ended' && (
        <p role="status" className="rounded-sm bg-surface-raised px-md py-sm text-caption">
          {after === 'failed' ? 'You were disconnected. Join again to go back in.' : after === 'time' ? 'The tour reached its time limit.' : 'You left the tour. You can join again while the link works.'}
        </p>
      )}

      <form onSubmit={join} className="flex flex-col gap-md rounded-lg border border-hairline bg-surface p-md sm:p-lg">
        <TextField label="Your name" autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} required />
        <label className="flex cursor-pointer items-start gap-sm">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 size-5 shrink-0 accent-accent-fill" />
          <span className="text-caption">
            I agree to join a video call with {tour.host}. They see my name, and hear me when my microphone is on. My camera stays off unless I turn it on. The
            call isn’t recorded.
          </span>
        </label>
        <p className="text-caption text-ink-secondary">
          Calls go through LiveKit. Read our{' '}
          <Link to="/privacy" className="text-accent">
            privacy notice
          </Link>
          .
        </p>
        <Button
          type="submit"
          disabled={busy || !name.trim() || !consent}
          icon={busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : <Video size={18} aria-hidden />}
          className="self-start"
        >
          Join the tour
        </Button>
        {error && (
          <p role="alert" className="text-caption text-critical">
            {error}
          </p>
        )}
      </form>
      {listingLink && <p className="text-caption">{listingLink}</p>}

      {pass && <Call pass={pass} title={tour.listing ? `Tour of ${tour.listing.title}` : 'Property tour'} start="voice" screenShare={false} onLeave={closed} />}
    </div>
  )
}
