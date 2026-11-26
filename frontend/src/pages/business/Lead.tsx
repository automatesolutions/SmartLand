import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, FileQuestion, LoaderCircle, Mail, Phone, RotateCw, Trash2 } from 'lucide-react'
import { ApiError, crmApi, type Activity, type Crm, type Lead, type LeadChange } from '../../lib/api'
import { useUser } from '../../lib/auth'
import { canManage, canWorkLeads, today, useCrm } from '../../lib/business'
import { formatDate } from '../../lib/format'
import { Button } from '../../components/Button'
import { Conversation } from '../../components/Conversation'
import { Banner, EmptyState, Skeleton } from '../../components/States'
import { SignInFor } from './Shared'

const select = 'h-tap w-full rounded-sm border border-hairline bg-surface px-sm text-ink focus-visible:border-focus disabled:opacity-60'

function activityText(a: Activity): string {
  const who = a.actor ?? 'The buyer'
  switch (a.kind) {
    case 'created':
      return a.body.source === 'inquiry' ? 'The buyer sent a message from the listing' : `${who} added this lead`
    case 'inquiry':
      return 'The buyer asked again from the listing'
    case 'note':
      return `${who} added a note`
    case 'stage':
      return `${who} moved it to ${a.body.to}`
    case 'assigned':
      return a.body.to ? `${who} assigned it to ${a.body.to}` : `${who} unassigned it`
    case 'follow_up':
      return a.body.on ? `${who} set a follow-up for ${formatDay(a.body.on)}` : `${who} cleared the follow-up`
  }
}

const formatDay = (on: string) => new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' }).format(new Date(`${on}T00:00:00`))

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-md rounded-lg border border-hairline bg-surface p-md sm:p-lg">
      <h2 className="text-tagline font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function NoteForm({ onAdd }: { onAdd: (text: string) => Promise<void> }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    setFailed(false)
    try {
      await onAdd(text.trim())
      setText('')
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-xs">
      <label htmlFor="note" className="font-semibold">
        Add a note
      </label>
      <p id="note-hint" className="text-caption text-ink-secondary">
        Only your team sees notes.
      </p>
      <textarea
        id="note"
        aria-describedby="note-hint"
        rows={2}
        maxLength={2000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="resize-y rounded-sm border border-hairline bg-surface px-md py-sm text-ink focus-visible:border-focus"
      />
      {failed && <p className="text-caption text-critical">The note didn't save. Check your connection, then try again.</p>}
      <Button type="submit" variant="secondary" className="self-start" disabled={busy || !text.trim()} icon={busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : undefined}>
        Save note
      </Button>
    </form>
  )
}

function Details({ lead, crm, onChange }: { lead: Lead; crm: Crm | null; onChange: (change: LeadChange) => Promise<void> }) {
  const editable = canWorkLeads(crm?.role)
  const [failed, setFailed] = useState(false)

  async function change(c: LeadChange) {
    setFailed(false)
    try {
      await onChange(c)
    } catch {
      setFailed(true)
    }
  }

  return (
    <Panel title="Details">
      <label className="flex flex-col gap-xs">
        <span className="font-semibold">Stage</span>
        <select value={lead.stage_id} disabled={!editable} onChange={(e) => void change({ stage_id: e.target.value })} className={select}>
          {(crm?.stages ?? [{ id: lead.stage_id, name: lead.stage }]).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {(crm?.members.length ?? 0) > 1 && (
        <label className="flex flex-col gap-xs">
          <span className="font-semibold">Assigned to</span>
          <select value={lead.assignee?.id ?? ''} disabled={!editable} onChange={(e) => void change({ assignee_id: e.target.value || null })} className={select}>
            <option value="">Nobody yet</option>
            {crm!.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex flex-col gap-xs">
        <label htmlFor="follow-up" className="font-semibold">
          Follow up on
        </label>
        <div className="flex items-center gap-xs">
          <input
            id="follow-up"
            type="date"
            min={today()}
            disabled={!editable}
            value={lead.follow_up_on ?? ''}
            onChange={(e) => void change({ follow_up_on: e.target.value || null })}
            className="h-tap min-w-0 flex-1 rounded-sm border border-hairline bg-surface px-sm text-ink focus-visible:border-focus disabled:opacity-60"
          />
          {editable && lead.follow_up_on && (
            <Button variant="plain" onClick={() => void change({ follow_up_on: null })}>
              Clear
            </Button>
          )}
        </div>
        <p className="text-caption text-ink-secondary">It shows on your business page on the day.</p>
      </div>
      {failed && <p className="text-caption text-critical">That change didn't save. Check your connection, then try again.</p>}
    </Panel>
  )
}

function DeleteLead({ lead }: { lead: Lead }) {
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  async function remove() {
    setBusy(true)
    setFailed(false)
    try {
      await crmApi.remove(lead.org_id, lead.id)
      navigate('/business/leads', { replace: true })
    } catch {
      setFailed(true)
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-xs">
      {confirm ? (
        <div role="group" aria-label="Confirm delete" className="flex flex-wrap items-center gap-sm">
          <span className="text-caption">Delete this lead, its messages, and {lead.contact.name}’s details for good?</span>
          <Button variant="plain" onClick={() => setConfirm(false)}>
            Keep
          </Button>
          <Button variant="secondary" className="border-critical text-critical" disabled={busy} onClick={() => void remove()}>
            Delete
          </Button>
        </div>
      ) : (
        <Button variant="plain" className="-ml-xs self-start text-critical" icon={<Trash2 size={18} aria-hidden />} onClick={() => setConfirm(true)}>
          Delete lead
        </Button>
      )}
      <p className="text-caption text-ink-secondary">Do this when the person asks you to remove their details.</p>
      {failed && <p className="text-caption text-critical">The lead wasn't deleted. Check your connection, then try again.</p>}
    </div>
  )
}

/** /business/leads/:id: one lead, its messages, notes, and timeline */
export function LeadPage() {
  const { id = '' } = useParams()
  const user = useUser()
  const { pathname } = useLocation()
  const [loaded, setLoaded] = useState<{ id: string; lead: Lead } | null>(null)
  const [failure, setFailure] = useState<{ id: string; err: unknown } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!user) return
    const controller = new AbortController()
    crmApi
      .find(id, controller.signal)
      .then((lead) => setLoaded({ id, lead }))
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') setFailure({ id, err })
      })
    return () => controller.abort()
  }, [id, user, attempt])

  const lead = loaded?.id === id ? loaded.lead : null
  const err = failure?.id === id ? failure.err : null
  // Stages, teammates, and your role, for the controls
  const { crm } = useCrm(lead?.org_id)

  if (!user) return <SignInFor from={pathname} title="Sign in to see this lead" />

  if (!lead && err) {
    const gone = err instanceof ApiError && err.kind === 'not-found'
    return (
      <EmptyState
        as="h1"
        icon={FileQuestion}
        title={gone ? 'This lead isn’t here' : "We couldn't load this lead"}
        body={gone ? 'It was deleted, or it belongs to a business account you’re not on.' : 'Check your connection, then try again.'}
        action={
          gone ? undefined : (
            <Button onClick={() => setAttempt((n) => n + 1)} icon={<RotateCw size={18} aria-hidden />}>
              Try again
            </Button>
          )
        }
      />
    )
  }

  if (!lead) {
    return (
      <div aria-busy className="gutter mx-auto flex max-w-reading flex-col gap-md py-xxl">
        <p role="status" className="sr-only">
          Loading the lead.
        </p>
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )
  }

  const set = (next: Lead) => setLoaded({ id, lead: next })
  const c = lead.contact

  return (
    <div className="gutter mx-auto flex max-w-reading flex-col gap-lg py-xl">
      <Link to="/business/leads" className="press -ml-xs inline-flex min-h-tap items-center gap-xxs self-start px-xs text-accent">
        <ChevronLeft size={20} aria-hidden />
        Leads
      </Link>
      <header className="flex flex-col gap-xxs">
        <h1 className="text-display-md">{c.name}</h1>
        <p className="text-ink-secondary">
          {lead.stage}
          {lead.listing ? (
            <>
              {' · '}
              <Link to={`/listing/${lead.listing.id}`} className="text-accent">
                {lead.listing.title}
              </Link>
            </>
          ) : (
            ' · Added by hand'
          )}
        </p>
      </header>

      <div className="grid gap-lg md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-lg">
          <Panel title="Messages">
            {lead.messages.length === 0 ? (
              <p className="text-ink-secondary">No messages. You added this lead by hand, so reach them by phone or email.</p>
            ) : (
              <Conversation
                messages={lead.messages}
                me="team"
                names={() => c.name}
                placeholder={`Reply to ${c.name}`}
                onSend={c.has_account && canWorkLeads(crm?.role) ? async (text) => set(await crmApi.reply(lead.org_id, lead.id, text)) : undefined}
              />
            )}
            {lead.messages.length > 0 && !c.has_account && (
              <Banner tone="caution" title="Reply by phone or email">
                {c.name} asked without a SmartLand account, so they can’t read replies here.
              </Banner>
            )}
          </Panel>

          <Panel title="Notes and history">
            {canWorkLeads(crm?.role) && <NoteForm onAdd={async (text) => set(await crmApi.note(lead.org_id, lead.id, text))} />}
            <ol className="flex flex-col gap-sm border-t border-hairline pt-md">
              {[...lead.activities].reverse().map((a) => (
                <li key={a.id} className="flex flex-col gap-xxs">
                  <p className="text-caption text-ink-secondary">
                    {activityText(a)} · {formatDate(a.created_at)}
                  </p>
                  {a.kind === 'note' && <p className="whitespace-pre-line rounded-sm bg-surface-raised px-md py-sm">{a.body.text}</p>}
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="flex flex-col gap-lg">
          <Panel title="Contact">
            <div className="flex flex-col gap-xs">
              {c.phone && (
                <a href={`tel:${c.phone}`} className="press inline-flex min-h-tap items-center gap-xs text-accent">
                  <Phone size={18} aria-hidden />
                  {c.phone}
                </a>
              )}
              {c.email && (
                <a href={`mailto:${c.email}`} className="press inline-flex min-h-tap items-center gap-xs break-all text-accent">
                  <Mail size={18} aria-hidden />
                  {c.email}
                </a>
              )}
              {!c.phone && !c.email && <p className="text-ink-secondary">No contact details. They were removed after the lead closed.</p>}
            </div>
            <p className="text-caption text-ink-secondary">
              {c.consent_at
                ? `${c.name} agreed on ${formatDate(c.consent_at)} to share these details with you about this property.`
                : 'Your team added these details by hand.'}{' '}
              Use them only to reply about this property.
            </p>
          </Panel>
          <Details lead={lead} crm={crm} onChange={async (change) => set(await crmApi.update(lead.org_id, lead.id, change))} />
          {canManage(crm?.role) && <DeleteLead lead={lead} />}
        </div>
      </div>
    </div>
  )
}
