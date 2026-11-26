import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { CalendarClock, Columns3, List, LoaderCircle, MessageCircle, Plus, UserRound, X } from 'lucide-react'
import { ApiError, crmApi, errorCopy, type Crm, type LeadSummary, type Org, type Stage } from '../../lib/api'
import { useUser } from '../../lib/auth'
import { canWorkLeads, followUpLabel, today, useCrm, useCurrentOrg, useMyOrgs } from '../../lib/business'
import { Button } from '../../components/Button'
import { TextArea, TextField } from '../../components/Fields'
import { Banner, Skeleton } from '../../components/States'
import { LoadFailed, OrgSwitcher, SignInFor } from './Shared'

type View = 'board' | 'list'
const VIEW_KEY = 'smartland:leads-view'

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'board'
  } catch {
    return 'board'
  }
}

const select = 'h-tap rounded-sm border border-hairline bg-surface px-sm text-ink focus-visible:border-focus'

function Unread({ n }: { n: number }) {
  if (!n) return null
  return (
    <span className="inline-flex items-center gap-xxs rounded-pill bg-accent-fill px-xs text-caption text-on-accent">
      <MessageCircle size={12} aria-hidden />
      {n} new
    </span>
  )
}

function FollowUp({ on }: { on: string | null }) {
  if (!on) return null
  const late = on < today()
  return (
    <span className={`inline-flex items-center gap-xxs text-caption ${late ? 'text-critical' : 'text-ink-secondary'}`}>
      <CalendarClock size={14} aria-hidden />
      {followUpLabel(on)}
    </span>
  )
}

/** "Move to" menu: the way to change stage with a keyboard or on a phone */
function MoveTo({ lead, stages, onMove }: { lead: LeadSummary; stages: Stage[]; onMove: (stage: Stage) => void }) {
  return (
    <label className="flex items-center gap-xs text-caption">
      <span className="text-ink-secondary">Move to</span>
      <select
        value={lead.stage_id}
        onChange={(e) => onMove(stages.find((s) => s.id === e.target.value)!)}
        aria-label={`Move ${lead.contact_name} to another stage`}
        className={`${select} min-w-0 flex-1 text-caption`}
      >
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function Board({ crm, editable, onMove }: { crm: Crm; editable: boolean; onMove: (lead: LeadSummary, stage: Stage) => void }) {
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)

  return (
    <div className="-mx-md overflow-x-auto px-md pb-md">
      <ol className="flex min-w-max gap-sm" aria-label="Pipeline">
        {crm.stages.map((stage) => {
          const leads = crm.leads.filter((l) => l.stage_id === stage.id)
          return (
            <li
              key={stage.id}
              aria-label={`${stage.name}, ${leads.length} ${leads.length === 1 ? 'lead' : 'leads'}`}
              onDragOver={(e) => {
                if (!dragging) return
                e.preventDefault()
                setOver(stage.id)
              }}
              onDragLeave={() => setOver((o) => (o === stage.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault()
                const lead = crm.leads.find((l) => l.id === dragging)
                setDragging(null)
                setOver(null)
                if (lead && lead.stage_id !== stage.id) onMove(lead, stage)
              }}
              className={`flex w-64 flex-col gap-xs rounded-lg p-xs transition-colors ${over === stage.id ? 'bg-accent-fill/10 ring-2 ring-accent' : 'bg-canvas-alt'}`}
            >
              <h2 className="flex items-baseline justify-between px-xs pt-xs font-semibold">
                {stage.name}
                <span className="text-caption font-regular text-ink-secondary">{leads.length}</span>
              </h2>
              <ul className="flex min-h-20 flex-col gap-xs">
                {leads.map((l) => (
                  <li
                    key={l.id}
                    draggable={editable}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', l.id)
                      setDragging(l.id)
                    }}
                    onDragEnd={() => {
                      setDragging(null)
                      setOver(null)
                    }}
                    className={`flex flex-col gap-xs rounded-md border border-hairline bg-surface p-sm ${editable ? 'cursor-grab active:cursor-grabbing' : ''} ${dragging === l.id ? 'opacity-50' : ''}`}
                  >
                    <Link to={`/business/leads/${l.id}`} className="press flex flex-col gap-xxs">
                      <span className="flex items-center justify-between gap-xs">
                        <span className="truncate font-semibold">{l.contact_name}</span>
                        <Unread n={l.unread} />
                      </span>
                      {l.listing && <span className="truncate text-caption text-ink-secondary">{l.listing.title}</span>}
                      <span className="flex flex-wrap items-center gap-x-sm gap-y-xxs">
                        <FollowUp on={l.follow_up_on} />
                        {l.assignee && (
                          <span className="inline-flex items-center gap-xxs text-caption text-ink-secondary">
                            <UserRound size={14} aria-hidden />
                            {l.assignee.name}
                          </span>
                        )}
                      </span>
                    </Link>
                    {editable && <MoveTo lead={l} stages={crm.stages} onMove={(s) => onMove(l, s)} />}
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function ListView({ crm, editable, onMove }: { crm: Crm; editable: boolean; onMove: (lead: LeadSummary, stage: Stage) => void }) {
  // Follow-ups first, soonest at the top; then the most recently active
  const rows = [...crm.leads].sort((a, b) => {
    if (a.follow_up_on && b.follow_up_on) return a.follow_up_on.localeCompare(b.follow_up_on)
    if (a.follow_up_on || b.follow_up_on) return a.follow_up_on ? -1 : 1
    return b.updated_at.localeCompare(a.updated_at)
  })
  return (
    <ul className="flex flex-col divide-y divide-hairline rounded-lg border border-hairline bg-surface">
      {rows.map((l) => (
        <li key={l.id} className="flex flex-col gap-xs p-md sm:flex-row sm:items-center sm:gap-md">
          <Link to={`/business/leads/${l.id}`} className="press flex min-w-0 flex-1 flex-col gap-xxs">
            <span className="flex items-center gap-xs">
              <span className="truncate font-semibold">{l.contact_name}</span>
              <Unread n={l.unread} />
            </span>
            <span className="truncate text-caption text-ink-secondary">
              {l.listing ? l.listing.title : 'Added by hand'}
              {l.assignee ? ` · ${l.assignee.name}` : ''}
            </span>
            <FollowUp on={l.follow_up_on} />
          </Link>
          <div className="sm:w-56">
            {editable ? <MoveTo lead={l} stages={crm.stages} onMove={(s) => onMove(l, s)} /> : <span className="text-caption text-ink-secondary">{l.stage}</span>}
          </div>
        </li>
      ))}
    </ul>
  )
}

function AddLead({ org, crm, onClose }: { org: Org; crm: Crm; onClose: () => void }) {
  const navigate = useNavigate()
  const user = useUser()!
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [followUp, setFollowUp] = useState('')
  const [assignee, setAssignee] = useState(user.id)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (name.trim().length < 2) return setError('Enter their name.')
    if (!phone.trim() && !email.trim()) return setError('Add a phone number or an email, so you can reach them.')
    setBusy(true)
    setError(null)
    try {
      const lead = await crmApi.add(org.id, {
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        listing_id: null,
        note: note.trim() || null,
        assignee_id: assignee || null,
        follow_up_on: followUp || null,
      })
      navigate(`/business/leads/${lead.id}`)
    } catch (err) {
      setError(err instanceof ApiError && err.kind === 'invalid' ? (err.detail ?? 'Check the phone number and email.') : errorCopy(err).body)
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="add-lead-heading" className="flex flex-col gap-md rounded-lg border border-hairline bg-surface p-md sm:p-lg">
      <div className="flex items-center justify-between">
        <h2 id="add-lead-heading" className="text-tagline font-semibold">
          Add a lead
        </h2>
        <button type="button" onClick={onClose} aria-label="Close" className="press inline-flex size-tap items-center justify-center rounded-pill text-ink-secondary">
          <X size={18} aria-hidden />
        </button>
      </div>
      <p className="text-caption text-ink-secondary">For someone who called, walked in, or reached you outside SmartLand. Save only what you need to reply.</p>
      <form onSubmit={onSubmit} noValidate aria-busy={busy} className="flex flex-col gap-md">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required />
        <div className="grid gap-md sm:grid-cols-2">
          <TextField label="Phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" />
          <TextField label="Email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </div>
        <TextArea label="Note" hint="Only your team sees notes." value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
        <div className="grid gap-md sm:grid-cols-2">
          <TextField label="Follow up on" type="date" value={followUp} min={today()} onChange={(e) => setFollowUp(e.target.value)} />
          {crm.members.length > 1 && (
            <label className="flex flex-col gap-xs">
              <span className="font-semibold">Assigned to</span>
              <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={select}>
                <option value="">Nobody yet</option>
                {crm.members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {error && <Banner tone="critical" title="We couldn't add the lead">{error}</Banner>}
        <Button type="submit" disabled={busy} className="self-start" icon={busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : <Plus size={18} aria-hidden />}>
          {busy ? 'Adding lead' : 'Add lead'}
        </Button>
      </form>
    </section>
  )
}

function OrgLeads({ org, orgs }: { org: Org; orgs: Org[] }) {
  const { crm, failed, reload, patchLead } = useCrm(org.id)
  const [view, setView] = useState<View>(readView)
  const [adding, setAdding] = useState(false)
  const [moveFailed, setMoveFailed] = useState(false)
  const editable = canWorkLeads(crm?.role)

  function changeView(v: View) {
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, v)
    } catch {
      // Storage blocked: the choice lasts for this visit
    }
  }

  async function move(lead: LeadSummary, stage: Stage) {
    const before = { stage_id: lead.stage_id, stage: lead.stage, closed_at: lead.closed_at }
    patchLead(lead.id, { stage_id: stage.id, stage: stage.name, closed_at: stage.outcome ? new Date().toISOString() : null })
    setMoveFailed(false)
    try {
      await crmApi.update(org.id, lead.id, { stage_id: stage.id })
    } catch {
      patchLead(lead.id, before)
      setMoveFailed(true)
    }
  }

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex flex-col gap-md sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-xxs">
          <h1 className="text-display-md">Leads</h1>
          <p className="text-ink-secondary">{org.kind === 'personal' ? 'From the listings you post as yourself' : org.name}</p>
        </div>
        <OrgSwitcher orgs={orgs} current={org} />
      </header>

      {failed && !crm ? (
        <LoadFailed what="your leads" onRetry={reload} />
      ) : !crm ? (
        <div aria-busy className="flex gap-sm">
          <p role="status" className="sr-only">
            Loading your leads.
          </p>
          <Skeleton className="h-64 w-64 rounded-lg" />
          <Skeleton className="h-64 w-64 rounded-lg" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <div role="group" aria-label="View" className="inline-flex rounded-pill border border-hairline p-xxs">
              {(['board', 'list'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => changeView(v)}
                  className={`press inline-flex min-h-tap items-center gap-xs rounded-pill px-md ${view === v ? 'bg-surface-raised font-semibold' : 'text-ink-secondary'}`}
                >
                  {v === 'board' ? <Columns3 size={16} aria-hidden /> : <List size={16} aria-hidden />}
                  {v === 'board' ? 'Board' : 'List'}
                </button>
              ))}
            </div>
            {editable && !adding && (
              <Button variant="secondary" icon={<Plus size={18} aria-hidden />} onClick={() => setAdding(true)}>
                Add lead
              </Button>
            )}
          </div>
          {adding && <AddLead org={org} crm={crm} onClose={() => setAdding(false)} />}
          {moveFailed && (
            <Banner tone="critical" title="That lead didn't move" onDismiss={() => setMoveFailed(false)}>
              Check your connection, then try again.
            </Banner>
          )}
          {crm.leads.length === 0 ? (
            <p className="rounded-lg border border-hairline bg-surface p-lg text-ink-secondary">
              {crm.role === 'guest'
                ? 'No leads are assigned to you yet.'
                : 'No leads yet. When a buyer taps “Message the seller” on one of these listings, they show up here in New.'}
            </p>
          ) : view === 'board' ? (
            <Board crm={crm} editable={editable} onMove={(l, s) => void move(l, s)} />
          ) : (
            <ListView crm={crm} editable={editable} onMove={(l, s) => void move(l, s)} />
          )}
        </>
      )}
    </div>
  )
}

/** /business/leads: the pipeline, as a board or a list */
export function LeadsPage() {
  const user = useUser()
  const { pathname } = useLocation()
  const { orgs, failed, reload } = useMyOrgs({ personal: true })
  const org = useCurrentOrg(orgs)

  if (!user) return <SignInFor from={pathname} title="Sign in to see your leads" />

  return (
    <div className="gutter mx-auto flex max-w-grid flex-col gap-lg py-xxl sm:py-section">
      {failed && !orgs ? (
        <LoadFailed what="your business accounts" onRetry={reload} />
      ) : !org || !orgs ? (
        <div aria-busy className="flex flex-col gap-sm">
          <p role="status" className="sr-only">
            Loading your leads.
          </p>
          <Skeleton className="h-12 w-1/3" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      ) : (
        <OrgLeads key={org.id} org={org} orgs={orgs} />
      )}
    </div>
  )
}
