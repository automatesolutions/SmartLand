import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CalendarPlus, LoaderCircle, Phone, Video } from 'lucide-react'
import { ApiError, meetingsApi, type BuyerCalls as State, type CallPass, type Meeting } from '../lib/api'
import { downloadCall, fromLocalInput, nowForInput } from '../lib/calendar'
import { useVisibleInterval } from '../lib/workspace'
import { Button } from './Button'
import { Call, type LeaveReason } from './Call'

const POLL_MS = 15000

/** In a buyer's conversation: join the seller's call, ask for a call, and see booked calls */
export function BuyerCalls({ threadId, seller, listing, onChanged }: {
  threadId: string
  seller: string
  listing: { id: string; title: string } | null
  /** The conversation gets a new message when you ask or cancel */
  onChanged: () => void
}) {
  const [state, setState] = useState<State | null>(null)
  const [pass, setPass] = useState<CallPass | null>(null)
  const [asking, setAsking] = useState(false)
  const [kind, setKind] = useState<'video' | 'voice'>('video')
  const [soon, setSoon] = useState(true)
  const [at, setAt] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    meetingsApi
      .buyer(threadId)
      .then(setState)
      .catch(() => {})
  }, [threadId])

  useEffect(() => {
    load()
  }, [load])
  useVisibleInterval(load, POLL_MS, !pass)

  if (!state?.enabled) return null

  async function run(what: string, fn: () => Promise<void>) {
    setBusy(what)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof ApiError && err.detail ? err.detail : 'That didn’t work. Check your connection, then try again.')
    } finally {
      setBusy(null)
    }
  }

  const join = () => run('join', async () => setPass(await meetingsApi.join(threadId)))

  async function ask(e: FormEvent) {
    e.preventDefault()
    if (!soon && !at) return
    await run('ask', async () => {
      await meetingsApi.ask(threadId, { kind, starts_at: soon ? null : fromLocalInput(at), note: note.trim() || null })
      setAsking(false)
      setNote('')
      setAt('')
      load()
      onChanged()
    })
  }

  const cancel = (m: Meeting) =>
    run(m.id, async () => {
      await meetingsApi.cancel(threadId, m.id)
      load()
      onChanged()
    })

  function closed(reason: LeaveReason) {
    if (reason !== 'ended') void meetingsApi.leave(threadId).catch(() => {})
    if (reason === 'failed') setError('You were disconnected. Join again to go back in.')
    setPass(null)
    load()
  }

  const call = state.call
  return (
    <section aria-labelledby="buyer-calls" className="flex flex-col gap-md rounded-lg border border-hairline bg-surface p-md sm:p-lg">
      <h2 id="buyer-calls" className="text-tagline font-semibold">
        Calls
      </h2>

      {call && (
        <div className="flex flex-wrap items-center justify-between gap-sm rounded-sm bg-positive-soft p-sm">
          <p className="font-semibold">{call.live ? `${seller} is in a call for you now` : 'It’s time for your call'}</p>
          <Button disabled={busy !== null} icon={busy === 'join' ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : <Video size={18} aria-hidden />} onClick={() => void join()}>
            Join the call
          </Button>
        </div>
      )}

      {state.meetings.length > 0 && (
        <ul className="flex flex-col gap-xs">
          {state.meetings.map((m) => (
            <li key={m.id} className="flex flex-col gap-xs rounded-sm bg-surface-raised p-sm">
              <p className="text-caption">
                <span className="font-semibold">
                  {m.status === 'requested' ? `You asked for a ${m.kind} call` : `${m.kind === 'video' ? 'Video' : 'Voice'} call booked`}
                </span>
                {` · ${m.when}`}
                {m.status === 'requested' && ' · Waiting for the seller to answer'}
              </p>
              <div className="flex flex-wrap gap-xs">
                {m.status === 'scheduled' && m.starts_at && (
                  <Button
                    variant="plain"
                    icon={<CalendarPlus size={16} aria-hidden />}
                    onClick={() =>
                      downloadCall({
                        id: m.id,
                        title: `SmartLand ${m.kind} call with ${seller}`,
                        startsAt: m.starts_at!,
                        details: listing ? `About ${listing.title}. Join from your Messages in SmartLand.` : 'Join from your Messages in SmartLand.',
                        url: `${window.location.origin}/messages/${threadId}`,
                      })
                    }
                  >
                    Add to calendar
                  </Button>
                )}
                <Button variant="plain" disabled={busy !== null} onClick={() => void cancel(m)}>
                  Cancel
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {asking ? (
        <form onSubmit={ask} className="flex flex-col gap-sm">
          <fieldset className="flex flex-wrap gap-md">
            <legend className="mb-xxs text-caption font-semibold">Kind of call</legend>
            <label className="inline-flex min-h-tap items-center gap-xs">
              <input type="radio" name="kind" checked={kind === 'video'} onChange={() => setKind('video')} className="accent-accent-fill" />
              <Video size={16} aria-hidden /> Video
            </label>
            <label className="inline-flex min-h-tap items-center gap-xs">
              <input type="radio" name="kind" checked={kind === 'voice'} onChange={() => setKind('voice')} className="accent-accent-fill" />
              <Phone size={16} aria-hidden /> Voice
            </label>
          </fieldset>
          <fieldset className="flex flex-col gap-xxs">
            <legend className="mb-xxs text-caption font-semibold">When</legend>
            <label className="inline-flex min-h-tap items-center gap-xs">
              <input type="radio" name="when" checked={soon} onChange={() => setSoon(true)} className="accent-accent-fill" />
              As soon as the seller can
            </label>
            <label className="inline-flex min-h-tap items-center gap-xs">
              <input type="radio" name="when" checked={!soon} onChange={() => setSoon(false)} className="accent-accent-fill" />
              At a time I pick
            </label>
            {!soon && (
              <input
                type="datetime-local"
                aria-label="Day and time"
                required
                min={nowForInput()}
                value={at}
                onChange={(e) => setAt(e.target.value)}
                className="h-tap rounded-sm border border-hairline bg-surface px-sm text-ink focus-visible:border-focus"
              />
            )}
          </fieldset>
          <label className="flex flex-col gap-xxs text-caption font-semibold">
            Note for the seller (optional)
            <input
              value={note}
              maxLength={300}
              onChange={(e) => setNote(e.target.value)}
              placeholder="For example, I’d like to see the road access"
              className="h-tap rounded-sm border border-hairline bg-surface px-sm font-regular text-ink focus-visible:border-focus"
            />
          </label>
          <div className="flex gap-xs">
            <Button type="submit" disabled={busy !== null || (!soon && !at)}>
              Ask for the call
            </Button>
            <Button variant="plain" onClick={() => setAsking(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-xxs">
          <Button variant="secondary" className="self-start" icon={<Video size={18} aria-hidden />} onClick={() => setAsking(true)}>
            Ask for a call
          </Button>
          <p className="text-caption text-ink-secondary">Talk with the seller, or ask them to show you the property live. Calls aren’t recorded.</p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-caption text-critical">
          {error}
        </p>
      )}
      {pass && <Call pass={pass} title={`Call with ${seller}`} start="voice" screenShare={false} onLeave={closed} />}
    </section>
  )
}
