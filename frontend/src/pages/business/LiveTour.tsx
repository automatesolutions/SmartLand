import { useCallback, useEffect, useState } from 'react'
import { Copy, LoaderCircle, MessageSquareText, Share2, Video } from 'lucide-react'
import { ApiError, callsApi, type CallPass, type CallView, type Lead } from '../../lib/api'
import { Button } from '../../components/Button'
import { Call, type LeaveReason } from '../../components/Call'

const time = (iso: string) => new Intl.DateTimeFormat('en-PH', { timeStyle: 'short' }).format(new Date(iso))

/** On a lead: make a private link, send it to the buyer, and show them the property on a video call */
export function LiveTour({ lead }: { lead: Lead }) {
  const [state, setState] = useState<{ enabled: boolean; call: CallView | null } | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [pass, setPass] = useState<CallPass | null>(null)
  const [busy, setBusy] = useState<'link' | 'join' | 'end' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const name = lead.contact.name.split(' ')[0] || lead.contact.name

  const load = useCallback((signal?: AbortSignal) => {
    callsApi
      .tour(lead.org_id, lead.id, signal)
      .then((s) => {
        setState(s)
        if (!s.call) setLink(null)
      })
      .catch(() => {
        // The panel stays hidden; the rest of the lead still works
      })
  }, [lead.org_id, lead.id])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  if (!state?.enabled) return null
  const call = state.call

  async function run(what: 'link' | 'join' | 'end', fn: () => Promise<void>) {
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

  const message = link
    ? `Hi ${name}, here’s the link for a live video tour${lead.listing ? ` of ${lead.listing.title}` : ''}: ${link}`
    : ''

  function closed(reason: LeaveReason) {
    if (pass && reason !== 'ended') void callsApi.leave(lead.org_id, pass.call.id).catch(() => {})
    if (reason === 'failed') setError('You were disconnected from the tour. Join again to go back in.')
    setPass(null)
    load()
  }

  return (
    <section aria-labelledby="tour-title" className="flex flex-col gap-md rounded-lg border border-hairline bg-surface p-md sm:p-lg">
      <div className="flex flex-col gap-xxs">
        <h2 id="tour-title" className="text-tagline font-semibold">
          Live tour
        </h2>
        <p className="text-caption text-ink-secondary">
          Show {name} the property on a video call from your phone. They join from a link, with no account. Calls aren’t recorded.
        </p>
      </div>

      {!call ? (
        <Button
          className="self-start"
          disabled={busy !== null}
          icon={busy === 'link' ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : <Video size={18} aria-hidden />}
          onClick={() => void makeLink()}
        >
          Make a tour link
        </Button>
      ) : (
        <>
          {link ? (
            <div className="flex flex-col gap-xs">
              <label htmlFor="tour-link" className="text-caption font-semibold">
                Send this link to {name}
              </label>
              <input
                id="tour-link"
                readOnly
                value={link}
                onFocus={(e) => e.currentTarget.select()}
                className="h-tap w-full rounded-sm border border-hairline bg-surface-raised px-sm text-caption text-ink"
              />
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
            </div>
          ) : (
            <p className="text-caption text-ink-secondary">
              A tour link is open. If you’ve lost it, get a new one. The old link stops working.
            </p>
          )}
          <p className="text-caption text-ink-secondary">
            The link works until {time(call.expires_at)}, or until you end the tour.
            {call.people.length > 0 && ` In the tour now: ${call.people.map((p) => (p.me ? 'you' : p.name)).join(', ')}.`}
          </p>
          <div className="flex flex-wrap gap-xs">
            <Button
              disabled={busy !== null}
              icon={busy === 'join' ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : <Video size={18} aria-hidden />}
              onClick={() => void run('join', async () => setPass(await callsApi.join(lead.org_id, call.id)))}
            >
              Start the tour
            </Button>
            {!link && (
              <Button variant="secondary" disabled={busy !== null} onClick={() => void makeLink()}>
                Get a new link
              </Button>
            )}
            <Button
              variant="plain"
              disabled={busy !== null}
              onClick={() =>
                void run('end', async () => {
                  await callsApi.end(lead.org_id, call.id)
                  setLink(null)
                  load()
                })
              }
            >
              End tour
            </Button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-caption text-critical">
          {error}
        </p>
      )}
      {pass && (
        <Call
          pass={pass}
          title={`Live tour with ${name}`}
          start="back-camera"
          screenShare={false}
          onLeave={closed}
          onEndForAll={async () => {
            await callsApi.end(lead.org_id, pass.call.id)
            setLink(null)
          }}
        />
      )}
    </section>
  )
}
