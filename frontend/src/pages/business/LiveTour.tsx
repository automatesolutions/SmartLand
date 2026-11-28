import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CalendarPlus, Copy, LoaderCircle, MessageSquareText, Phone, Share2, Video } from 'lucide-react'
import { ApiError, callsApi, meetingsApi, type CallPass, type CallView, type Lead, type Meeting } from '../../lib/api'
import { downloadCall, fromLocalInput, nowForInput } from '../../lib/calendar'
import { Button } from '../../components/Button'
import { Call, type LeaveReason } from '../../components/Call'

const time = (iso: string) => new Intl.DateTimeFormat('en-PH', { timeStyle: 'short' }).format(new Date(iso))
const input = 'h-tap w-full rounded-sm border border-hairline bg-surface px-sm text-ink focus-visible:border-focus'

type Start = 'back-camera' | 'front-camera' | 'voice'

function TimeForm({ label, submit, onDone, onCancel }: { label: string; submit: (startsAt: string) => Promise<void>; onDone: () => void; onCancel: () => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="flex flex-wrap items-end gap-xs"
      onSubmit={async (e: FormEvent) => {
        e.preventDefault()
        if (!value) return
        setBusy(true)
        try {
          await submit(fromLocalInput(value))
          onDone()
        } finally {
          setBusy(false)
        }
      }}
    >
      <label className="flex min-w-48 flex-1 flex-col gap-xxs text-caption font-semibold">
        {label}
        <input type="datetime-local" required min={nowForInput()} value={value} onChange={(e) => setValue(e.target.value)} className={input} />
      </label>
      <Button type="submit" variant="secondary" disabled={busy || !value}>
        Save
      </Button>
      <Button variant="plain" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  )
}

/** On a lead: call the buyer, answer their call requests, book a time, or send a link */
export function LiveTour({ lead }: { lead: Lead }) {
  const [state, setState] = useState<{ enabled: boolean; call: CallView | null } | null>(null)
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [link, setLink] = useState<string | null>(null)
  const [pass, setPass] = useState<{ pass: CallPass; start: Start } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [picking, setPicking] = useState<string | null>(null)
  const [booking, setBooking] = useState(false)
  const [kind, setKind] = useState<'video' | 'voice'>('video')
  const name = lead.contact.name.split(' ')[0] || lead.contact.name
  const account = lead.contact.has_account

  const load = useCallback(
    (signal?: AbortSignal) => {
      callsApi
        .tour(lead.org_id, lead.id, signal)
        .then((s) => {
          setState(s)
          if (!s.call) setLink(null)
        })
        .catch(() => {
          // The panel stays hidden; the rest of the lead still works
        })
      meetingsApi
        .forLead(lead.org_id, lead.id, signal)
        .then(setMeetings)
        .catch(() => {})
    },
    [lead.org_id, lead.id],
  )

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  if (!state?.enabled) return null
  const call = state.call

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

  const makeLink = () =>
    run('link', async () => {
      const res = await callsApi.startTour(lead.org_id, lead.id)
      setLink(`${window.location.origin}${res.link}`)
      setState({ enabled: true, call: res.call })
      setCopied(false)
    })

  // Opens the lead's call, making it first if there isn't one
  const start = (how: Start) =>
    run(how, async () => {
      const id = call?.id ?? (await callsApi.startTour(lead.org_id, lead.id)).call.id
      setPass({ pass: await callsApi.join(lead.org_id, id), start: how })
    })

  const answer = (m: Meeting, status: 'scheduled' | 'canceled', startsAt?: string) =>
    run(m.id, async () => {
      await meetingsApi.answer(lead.org_id, lead.id, m.id, status, startsAt)
      load()
    })

  const message = link ? `Hi ${name}, here’s the link for our call${lead.listing ? ` about ${lead.listing.title}` : ''}: ${link}` : ''

  function closed(reason: LeaveReason) {
    if (pass && reason !== 'ended') void callsApi.leave(lead.org_id, pass.pass.call.id).catch(() => {})
    if (reason === 'failed') setError('You were disconnected from the call. Start it again to go back in.')
    setPass(null)
    load()
  }

  const spin = (what: string) => (busy === what ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : null)

  return (
    <section aria-labelledby="calls-title" className="flex flex-col gap-md rounded-lg border border-hairline bg-surface p-md sm:p-lg">
      <div className="flex flex-col gap-xxs">
        <h2 id="calls-title" className="text-tagline font-semibold">
          Calls with {name}
        </h2>
        <p className="text-caption text-ink-secondary">
          {account
            ? `${name} has a SmartLand account, so they get a message and join from their Messages when you start a call.`
            : `${name} doesn’t have a SmartLand account. Send them a link to join.`}{' '}
          Calls aren’t recorded.
        </p>
      </div>

      {meetings.length > 0 && (
        <ul className="flex flex-col gap-sm">
          {meetings.map((m) => (
            <li key={m.id} className="flex flex-col gap-xs rounded-sm bg-surface-raised p-sm">
              <p className="text-caption">
                <span className="font-semibold">
                  {m.status === 'requested' ? `${name} asked for a ${m.kind} call` : `${m.kind === 'video' ? 'Video' : 'Voice'} call booked`}
                </span>
                {` · ${m.when}`}
              </p>
              {m.note && <p className="text-caption text-ink-secondary">“{m.note}”</p>}
              {picking === m.id ? (
                <TimeForm label="New time" submit={(t) => meetingsApi.answer(lead.org_id, lead.id, m.id, 'scheduled', t).then(() => {})} onDone={() => { setPicking(null); load() }} onCancel={() => setPicking(null)} />
              ) : (
                <div className="flex flex-wrap gap-xs">
                  {m.status === 'requested' && (
                    <Button variant="secondary" disabled={busy !== null} onClick={() => void answer(m, 'scheduled')}>
                      {m.starts_at ? 'Accept' : 'Accept for now'}
                    </Button>
                  )}
                  {m.joinable && (
                    <Button disabled={busy !== null} icon={<Video size={16} aria-hidden />} onClick={() => void start(m.kind === 'video' ? 'front-camera' : 'voice')}>
                      Start the call
                    </Button>
                  )}
                  <Button variant="plain" disabled={busy !== null} onClick={() => setPicking(m.id)}>
                    {m.status === 'requested' ? 'Pick another time' : 'Move'}
                  </Button>
                  {m.status === 'scheduled' && m.starts_at && (
                    <Button
                      variant="plain"
                      icon={<CalendarPlus size={16} aria-hidden />}
                      onClick={() =>
                        downloadCall({
                          id: m.id,
                          title: `SmartLand ${m.kind} call with ${lead.contact.name}`,
                          startsAt: m.starts_at!,
                          details: lead.listing ? `About ${lead.listing.title}. Start it from the lead in SmartLand.` : 'Start it from the lead in SmartLand.',
                          url: `${window.location.origin}/business/leads/${lead.id}`,
                        })
                      }
                    >
                      Add to calendar
                    </Button>
                  )}
                  <Button variant="plain" disabled={busy !== null} onClick={() => void answer(m, 'canceled')}>
                    {m.status === 'requested' ? 'Decline' : 'Cancel'}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-xs">
        <Button disabled={busy !== null} icon={spin('back-camera') ?? <Video size={18} aria-hidden />} onClick={() => void start('back-camera')}>
          Live tour
        </Button>
        <Button variant="secondary" disabled={busy !== null} icon={spin('front-camera') ?? <Video size={18} aria-hidden />} onClick={() => void start('front-camera')}>
          Video call
        </Button>
        <Button variant="secondary" disabled={busy !== null} icon={spin('voice') ?? <Phone size={18} aria-hidden />} onClick={() => void start('voice')}>
          Voice call
        </Button>
      </div>
      <p className="text-caption text-ink-secondary">
        Live tour opens your back camera to show the property.
        {call && call.people.length > 0 && ` In the call now: ${call.people.map((p) => (p.me ? 'you' : p.name)).join(', ')}.`}
      </p>

      {booking ? (
        <div className="flex flex-col gap-xs">
          <fieldset className="flex gap-md text-caption">
            <legend className="sr-only">Kind of call</legend>
            {(['video', 'voice'] as const).map((k) => (
              <label key={k} className="inline-flex min-h-tap items-center gap-xs">
                <input type="radio" name="call-kind" checked={kind === k} onChange={() => setKind(k)} className="accent-accent-fill" />
                {k === 'video' ? 'Video call' : 'Voice call'}
              </label>
            ))}
          </fieldset>
          <TimeForm
            label="Day and time"
            submit={(t) => meetingsApi.book(lead.org_id, lead.id, { kind, starts_at: t }).then(() => {})}
            onDone={() => {
              setBooking(false)
              load()
            }}
            onCancel={() => setBooking(false)}
          />
        </div>
      ) : (
        <Button variant="plain" className="self-start" icon={<CalendarPlus size={16} aria-hidden />} onClick={() => setBooking(true)}>
          Book a call for later
        </Button>
      )}

      <div className="flex flex-col gap-xs border-t border-hairline pt-md">
        {link ? (
          <>
            <label htmlFor="tour-link" className="text-caption font-semibold">
              Send this link to {name}
            </label>
            <input id="tour-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} className={`${input} bg-surface-raised text-caption`} />
            <div className="flex flex-wrap gap-xs">
              <Button
                variant="secondary"
                icon={<Copy size={16} aria-hidden />}
                onClick={() => navigator.clipboard?.writeText(message).then(() => setCopied(true), () => setCopied(false))}
              >
                {copied ? 'Copied' : 'Copy message'}
              </Button>
              {lead.contact.phone && (
                <a
                  href={`sms:${lead.contact.phone}?body=${encodeURIComponent(message)}`}
                  className="press inline-flex min-h-tap items-center gap-xs rounded-pill border border-accent px-btn-x text-accent"
                >
                  <MessageSquareText size={16} aria-hidden />
                  Text it
                </a>
              )}
              {typeof navigator.share === 'function' && (
                <Button variant="secondary" icon={<Share2 size={16} aria-hidden />} onClick={() => void navigator.share({ text: message }).catch(() => {})}>
                  Share
                </Button>
              )}
            </div>
            {call && <p className="text-caption text-ink-secondary">The link works until {time(call.expires_at)}, or until you end the call.</p>}
          </>
        ) : (
          <Button variant="plain" className="self-start" disabled={busy !== null} icon={spin('link')} onClick={() => void makeLink()}>
            {call ? 'Get a new link (the old one stops working)' : 'Get a link to send'}
          </Button>
        )}
        {call && (
          <Button
            variant="plain"
            className="self-start"
            disabled={busy !== null}
            onClick={() =>
              void run('end', async () => {
                await callsApi.end(lead.org_id, call.id)
                setLink(null)
                load()
              })
            }
          >
            End the call for everyone
          </Button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-caption text-critical">
          {error}
        </p>
      )}
      {pass && (
        <Call
          pass={pass.pass}
          title={pass.start === 'back-camera' ? `Live tour with ${name}` : `Call with ${name}`}
          start={pass.start}
          screenShare={false}
          onLeave={closed}
          onEndForAll={async () => {
            await callsApi.end(lead.org_id, pass.pass.call.id)
            setLink(null)
          }}
        />
      )}
    </section>
  )
}
