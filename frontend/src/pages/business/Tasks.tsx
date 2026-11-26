import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { CalendarClock, LoaderCircle, Plus, UserRound } from 'lucide-react'
import { ApiError, workspaceApi, type Org, type OrgRole, type Task, type TaskChange, type WsMember } from '../../lib/api'
import { useUser } from '../../lib/auth'
import { canManage, followUpLabel, today, useCurrentOrg, useMyOrgs } from '../../lib/business'
import { Button } from '../../components/Button'
import { Banner, Skeleton } from '../../components/States'
import { LoadFailed, NoOrgYet, OrgSwitcher, SignInFor } from './Shared'

const field = 'h-tap rounded-sm border border-hairline bg-surface px-sm text-ink focus-visible:border-focus'

function TaskForm({ org, members, leadId, onAdded }: { org: Pick<Org, 'id'>; members: WsMember[]; leadId?: string; onAdded: (t: Task) => void }) {
  const me = useUser()!
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState(me.id)
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) return setError('Give the task a title.')
    setBusy(true)
    setError(null)
    try {
      onAdded(await workspaceApi.addTask(org.id, { title: title.trim(), assignee_id: assignee || null, due_on: due || null, lead_id: leadId ?? null }))
      setTitle('')
      setDue('')
    } catch (err) {
      setError(err instanceof ApiError && err.detail ? err.detail : 'The task didn’t save. Check your connection, then try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} aria-label="Add a task" className="flex flex-col gap-sm">
      <label className="flex flex-col gap-xs">
        <span className="font-semibold">New task</span>
        <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="Send the tax declaration copy" className={field} />
      </label>
      <div className="grid gap-sm sm:grid-cols-2">
        <label className="flex flex-col gap-xs">
          <span className="text-caption font-semibold">Assigned to</span>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={field}>
            <option value="">Nobody yet</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === me.id ? `${m.name} (you)` : m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-xs">
          <span className="text-caption font-semibold">Due</span>
          <input type="date" value={due} min={today()} onChange={(e) => setDue(e.target.value)} className={field} />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-caption text-critical">
          {error}
        </p>
      )}
      <Button type="submit" variant="secondary" disabled={busy} className="self-start" icon={busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : <Plus size={18} aria-hidden />}>
        Add task
      </Button>
    </form>
  )
}

function TaskRow({ t, org, role, onChange, onRemoved }: { t: Task; org: Pick<Org, 'id'>; role: OrgRole; onChange: (t: Task) => void; onRemoved: () => void }) {
  const me = useUser()!
  const [failed, setFailed] = useState(false)
  const editable = role !== 'guest'
  const done = t.status === 'done'

  async function change(c: TaskChange) {
    setFailed(false)
    try {
      onChange(await workspaceApi.updateTask(org.id, t.id, c))
    } catch {
      setFailed(true)
    }
  }

  return (
    <li className="flex items-start gap-sm p-md">
      <input
        type="checkbox"
        checked={done}
        disabled={!editable}
        onChange={() => void change({ status: done ? 'open' : 'done' })}
        aria-label={done ? `Mark “${t.title}” as not done` : `Mark “${t.title}” as done`}
        className="mt-1 size-5 shrink-0 accent-accent-fill"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-xxs">
        <p className={done ? 'text-ink-secondary line-through' : 'font-semibold'}>{t.title}</p>
        <p className="flex flex-wrap items-center gap-x-sm gap-y-xxs text-caption text-ink-secondary">
          {t.due_on && (
            <span className={`inline-flex items-center gap-xxs ${!done && t.due_on < today() ? 'text-critical' : ''}`}>
              <CalendarClock size={14} aria-hidden />
              {followUpLabel(t.due_on)}
            </span>
          )}
          <span className="inline-flex items-center gap-xxs">
            <UserRound size={14} aria-hidden />
            {t.assignee ? (t.assignee.id === me.id ? 'You' : t.assignee.name) : 'Nobody yet'}
          </span>
          {t.lead && (
            <Link to={`/business/leads/${t.lead.id}`} className="text-accent">
              Lead: {t.lead.name}
            </Link>
          )}
          {t.listing && (
            <Link to={`/listing/${t.listing.id}`} className="text-accent">
              {t.listing.title}
            </Link>
          )}
        </p>
        {t.notes && <p className="whitespace-pre-line text-caption">{t.notes}</p>}
        {failed && <p className="text-caption text-critical">That change didn’t save. Check your connection, then try again.</p>}
      </div>
      {editable && (t.created_by === me.id || canManage(role)) && (
        <Button variant="plain" className="text-caption" onClick={() => void workspaceApi.removeTask(org.id, t.id).then(onRemoved, () => setFailed(true))}>
          Delete
        </Button>
      )}
    </li>
  )
}

function TaskList({ tasks, org, role, setTasks }: { tasks: Task[]; org: Pick<Org, 'id'>; role: OrgRole; setTasks: (fn: (ts: Task[]) => Task[]) => void }) {
  return (
    <ul className="flex flex-col divide-y divide-hairline rounded-lg border border-hairline bg-surface">
      {tasks.map((t) => (
        <TaskRow
          key={t.id}
          t={t}
          org={org}
          role={role}
          onChange={(next) => setTasks((ts) => ts.map((x) => (x.id === next.id ? next : x)))}
          onRemoved={() => setTasks((ts) => ts.filter((x) => x.id !== t.id))}
        />
      ))}
    </ul>
  )
}

/** Tasks linked to one lead, on the lead page. Hidden for personal CRMs, which have no workspace. */
export function LeadTasks({ orgId, leadId }: { orgId: string; leadId: string }) {
  const org = { id: orgId }
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [members, setMembers] = useState<WsMember[]>([])
  const [role, setRole] = useState<OrgRole>('guest')

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([workspaceApi.tasks(orgId, { lead_id: leadId }, controller.signal), workspaceApi.load(orgId, controller.signal)])
      .then(([ts, ws]) => {
        setTasks(ts)
        setMembers(ws.members)
        setRole(ws.role)
      })
      .catch(() => {
        // The lead page works without its tasks
      })
    return () => controller.abort()
  }, [orgId, leadId])

  if (!tasks) return null
  return (
    <section aria-label="Tasks" className="flex flex-col gap-md rounded-lg border border-hairline bg-surface p-md sm:p-lg">
      <h2 className="text-tagline font-semibold">Tasks</h2>
      {tasks.length > 0 && <TaskList tasks={tasks} org={org} role={role} setTasks={(fn) => setTasks((ts) => fn(ts ?? []))} />}
      {role !== 'guest' && <TaskForm org={org} members={members} leadId={leadId} onAdded={(t) => setTasks((ts) => [t, ...(ts ?? [])])} />}
    </section>
  )
}

function OrgTasks({ org, orgs }: { org: Org; orgs: Org[] }) {
  const [status, setStatus] = useState<'open' | 'done'>('open')
  const [mine, setMine] = useState(false)
  const [tasks, setTasks] = useState<Task[] | null>(null)
  const [members, setMembers] = useState<WsMember[]>([])
  const [role, setRole] = useState<OrgRole>('guest')
  const [failed, setFailed] = useState(false)
  const [adding, setAdding] = useState(false)

  const load = useCallback(() => {
    Promise.all([workspaceApi.tasks(org.id, { status, mine }), workspaceApi.load(org.id)])
      .then(([ts, ws]) => {
        setFailed(false)
        setTasks(ts)
        setMembers(ws.members)
        setRole(ws.role)
      })
      .catch(() => setFailed(true))
  }, [org.id, status, mine])

  useEffect(load, [load])

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex flex-col gap-md sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-xxs">
          <h1 className="text-display-md">Tasks</h1>
          <p className="text-ink-secondary">{org.name}</p>
        </div>
        <OrgSwitcher orgs={orgs} current={org} />
      </header>
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <div className="flex flex-wrap items-center gap-md">
          <div role="group" aria-label="Show" className="inline-flex rounded-pill border border-hairline p-xxs">
            {(['open', 'done'] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={status === s}
                onClick={() => setStatus(s)}
                className={`press inline-flex min-h-tap items-center rounded-pill px-md ${status === s ? 'bg-surface-raised font-semibold' : 'text-ink-secondary'}`}
              >
                {s === 'open' ? 'Open' : 'Done'}
              </button>
            ))}
          </div>
          <label className="inline-flex min-h-tap cursor-pointer items-center gap-xs">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="size-5 accent-accent-fill" />
            Only mine
          </label>
        </div>
        {role !== 'guest' && !adding && (
          <Button variant="secondary" icon={<Plus size={18} aria-hidden />} onClick={() => setAdding(true)}>
            Add task
          </Button>
        )}
      </div>
      {adding && (
        <div className="rounded-lg border border-hairline bg-surface p-md sm:p-lg">
          <TaskForm
            org={org}
            members={members}
            onAdded={(t) => {
              setAdding(false)
              if (status === 'open') setTasks((ts) => [t, ...(ts ?? [])])
            }}
          />
        </div>
      )}
      {failed && !tasks ? (
        <LoadFailed what="your tasks" onRetry={load} />
      ) : !tasks ? (
        <div aria-busy className="flex flex-col gap-sm">
          <p role="status" className="sr-only">
            Loading tasks.
          </p>
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : tasks.length === 0 ? (
        <p className="rounded-lg border border-hairline bg-surface p-lg text-ink-secondary">
          {status === 'open' ? 'No open tasks. Add one here, or from a lead’s page.' : 'No finished tasks yet.'}
        </p>
      ) : (
        <TaskList tasks={tasks} org={org} role={role} setTasks={(fn) => setTasks((ts) => fn(ts ?? []))} />
      )}
      {failed && tasks && (
        <Banner tone="critical" title="We couldn't refresh the tasks">
          Check your connection, then try again.
        </Banner>
      )}
    </div>
  )
}

/** /business/tasks: the team's to-do list */
export function TasksPage() {
  const user = useUser()
  const { pathname } = useLocation()
  const { orgs, failed, reload } = useMyOrgs()
  const org = useCurrentOrg(orgs)

  if (!user) return <SignInFor from={pathname} title="Sign in to see your tasks" />
  if (orgs && !org) return <NoOrgYet />

  return (
    <div className="gutter mx-auto flex max-w-reading flex-col gap-lg py-xxl sm:py-section">
      {failed && !orgs ? (
        <LoadFailed what="your business accounts" onRetry={reload} />
      ) : !org || !orgs ? (
        <div aria-busy className="flex flex-col gap-sm">
          <p role="status" className="sr-only">
            Loading your tasks.
          </p>
          <Skeleton className="h-12 w-1/3" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      ) : (
        <OrgTasks key={org.id} org={org} orgs={orgs} />
      )}
    </div>
  )
}
