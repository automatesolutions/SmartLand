import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { Archive, AtSign, ChevronLeft, Headphones, LoaderCircle, MessageSquarePlus, Paperclip, Plus, Send, X } from 'lucide-react'
import { ApiError, callsApi, workspaceApi, type CallPass, type Org, type Workspace, type WsChannel, type WsMember, type WsMessage } from '../../lib/api'
import { useCallsConfig } from '../../lib/calls'
import { ACCEPT, MAX_FILES, useAttachments, useFilesOn, type AttachFn } from '../../lib/teamFiles'
import { AttachmentChips, FileList } from '../../components/ChatFiles'
import { Call, type LeaveReason } from '../../components/Call'
import { useUser } from '../../lib/auth'
import { canManage, useCurrentOrg, useMyOrgs } from '../../lib/business'
import { formatDate } from '../../lib/format'
import { WORKSPACE_READ, channelLabel, mentionParts, toEditable, toStored, useVisibleInterval } from '../../lib/workspace'
import { Button } from '../../components/Button'
import { Banner, Skeleton } from '../../components/States'
import { LoadFailed, NoOrgYet, OrgSwitcher, SignInFor } from './Shared'

const POLL_MESSAGES_MS = 4000
const POLL_CHANNELS_MS = 15000

function Badge({ c }: { c: WsChannel }) {
  if (c.mentions) {
    return (
      <span className="inline-flex shrink-0 items-center rounded-pill bg-critical px-xs text-caption text-on-accent">
        <AtSign size={12} aria-hidden />
        {c.mentions}
        <span className="sr-only"> {c.mentions === 1 ? 'mention' : 'mentions'}</span>
      </span>
    )
  }
  if (!c.unread) return null
  return (
    <span className="shrink-0 rounded-pill bg-accent-fill px-xs text-caption text-on-accent">
      {c.unread}
      <span className="sr-only"> new</span>
    </span>
  )
}

function Sidebar({
  org,
  ws,
  current,
  onPick,
  onChanged,
}: {
  org: Org
  ws: Workspace
  current: string | null
  onPick: (id: string) => void
  onChanged: (pick?: string) => void
}) {
  const me = useUser()!
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const channels = ws.channels.filter((c) => c.kind === 'channel')
  const dms = ws.channels.filter((c) => c.kind === 'dm')
  const withDm = new Set(dms.map((d) => d.with?.id))
  const others = ws.members.filter((m) => m.id !== me.id && !withDm.has(m.id))

  async function addChannel(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      const made = await workspaceApi.createChannel(org.id, name, null)
      setName('')
      setAdding(false)
      onChanged(made.id)
    } catch (err) {
      setError(err instanceof ApiError && err.detail ? err.detail : 'Use letters, numbers, and dashes, like viewings.')
    }
  }

  async function startDm(userId: string) {
    try {
      const dm = await workspaceApi.openDm(org.id, userId)
      onChanged(dm.id)
    } catch {
      setError('That chat didn’t open. Check your connection, then try again.')
    }
  }

  const item = (c: WsChannel) => (
    <li key={c.id}>
      <button
        type="button"
        onClick={() => onPick(c.id)}
        aria-current={current === c.id ? 'page' : undefined}
        className={`press flex min-h-tap w-full items-center gap-xs rounded-sm px-sm text-left ${
          current === c.id ? 'bg-surface-raised font-semibold' : c.unread ? 'font-semibold' : 'text-ink-secondary'
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{channelLabel(c)}</span>
        {c.huddle && (
          <span className="inline-flex shrink-0 items-center gap-xxs text-caption text-positive">
            <Headphones size={14} aria-hidden />
            <span className="sr-only">Huddle on,</span>
            {c.huddle.people.length || ''}
          </span>
        )}
        <Badge c={c} />
      </button>
    </li>
  )

  return (
    <nav aria-label="Channels and direct messages" className="flex flex-col gap-md">
      <div className="flex flex-col gap-xxs">
        <h2 className="px-sm text-caption font-semibold text-ink-secondary">Channels</h2>
        <ul>{channels.map(item)}</ul>
        {canManage(ws.role) &&
          (adding ? (
            <form onSubmit={addChannel} className="flex flex-col gap-xs px-sm pt-xs">
              <label htmlFor="new-channel" className="text-caption font-semibold">
                Channel name
              </label>
              <div className="flex items-center gap-xs">
                <input
                  id="new-channel"
                  autoFocus
                  value={name}
                  maxLength={40}
                  placeholder="viewings"
                  onChange={(e) => setName(e.target.value)}
                  className="h-tap min-w-0 flex-1 rounded-sm border border-hairline bg-surface px-sm text-ink focus-visible:border-focus"
                />
                <button type="button" aria-label="Cancel" onClick={() => setAdding(false)} className="press inline-flex size-tap items-center justify-center rounded-pill text-ink-secondary">
                  <X size={18} aria-hidden />
                </button>
              </div>
              <Button type="submit" variant="secondary" disabled={!name.trim()} className="self-start">
                Add channel
              </Button>
            </form>
          ) : (
            <Button variant="plain" className="self-start" icon={<Plus size={16} aria-hidden />} onClick={() => setAdding(true)}>
              New channel
            </Button>
          ))}
      </div>
      <div className="flex flex-col gap-xxs">
        <h2 className="px-sm text-caption font-semibold text-ink-secondary">Direct messages</h2>
        {dms.length > 0 && <ul>{dms.map(item)}</ul>}
        {others.length > 0 && (
          <label className="flex flex-col gap-xxs px-sm pt-xs">
            <span className="sr-only">Message a teammate</span>
            <select
              value=""
              onChange={(e) => e.target.value && void startDm(e.target.value)}
              className="h-tap rounded-sm border border-hairline bg-surface px-sm text-ink focus-visible:border-focus"
            >
              <option value="">Message a teammate</option>
              {others.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {ws.members.length === 1 && (
          <p className="px-sm text-caption text-ink-secondary">
            Only you so far. <Link to="/business/team" className="text-accent">Invite your team</Link>.
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="px-sm text-caption text-critical">
          {error}
        </p>
      )}
    </nav>
  )
}

function Body({ body, members, me }: { body: string; members: WsMember[]; me: string }) {
  return (
    <p className="whitespace-pre-line break-words">
      {mentionParts(body).map((p, i) =>
        'text' in p ? (
          <span key={i}>{p.text}</span>
        ) : (
          <span key={i} className={`rounded-xs px-xxs font-semibold ${p.mention === me ? 'bg-caution-soft' : 'bg-surface-raised text-accent'}`}>
            @{members.find((m) => m.id === p.mention)?.name ?? 'someone who left'}
          </span>
        ),
      )}
    </p>
  )
}

/** Textarea with @mention suggestions, and files when `attach` is set. Enter sends, Shift+Enter adds a line. */
function Composer({
  members,
  initial = '',
  placeholder,
  submitLabel,
  onSubmit,
  onCancel,
  attach,
}: {
  members: WsMember[]
  initial?: string
  placeholder?: string
  submitLabel: string
  onSubmit: (stored: string, fileIds: string[]) => Promise<void>
  onCancel?: () => void
  attach?: AttachFn
}) {
  const me = useUser()!
  const [text, setText] = useState(initial)
  const [caret, setCaret] = useState(initial.length)
  const [pick, setPick] = useState(0)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const attachments = useAttachments(attach)
  const canSend = !busy && !attachments.uploading && (!!text.trim() || attachments.ready.length > 0)

  // "@an" right before the caret: suggest teammates whose names start with "an"
  const query = /(?:^|\s)@([^\s@]{0,30})$/.exec(text.slice(0, caret))?.[1]
  const suggestions =
    query === undefined ? [] : members.filter((m) => m.id !== me.id && m.name.toLowerCase().startsWith(query.toLowerCase())).slice(0, 6)

  function insert(m: WsMember) {
    const start = caret - (query?.length ?? 0) - 1
    const next = `${text.slice(0, start)}@${m.name} ${text.slice(caret)}`
    setText(next)
    const at = start + m.name.length + 2
    setCaret(at)
    requestAnimationFrame(() => {
      box.current?.focus()
      box.current?.setSelectionRange(at, at)
    })
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault()
    if (!canSend) return
    setBusy(true)
    setFailure(null)
    try {
      await onSubmit(toStored(text.trim(), members), attachments.ready)
      setText('')
      setCaret(0)
      attachments.clear()
    } catch (err) {
      setFailure(
        err instanceof ApiError && err.kind === 'rate-limited'
          ? 'You’ve sent a lot of messages in a short time. Wait a while, then try again.'
          : err instanceof ApiError && err.detail && (err.kind === 'conflict' || err.kind === 'forbidden')
            ? err.detail
            : 'Your message didn’t send. Check your connection, then try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setPick((p) => (p + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insert(suggestions[Math.min(pick, suggestions.length - 1)])
        return
      }
    }
    if (e.key === 'Escape' && onCancel) onCancel()
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <form onSubmit={submit} className="relative flex flex-col gap-xs">
      {suggestions.length > 0 && (
        <ul role="listbox" aria-label="Mention a teammate" className="absolute bottom-full left-0 z-10 mb-xs w-64 overflow-hidden rounded-md border border-hairline bg-surface shadow-lg">
          {suggestions.map((m, i) => (
            <li key={m.id} role="option" aria-selected={i === pick}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insert(m)}
                className={`flex min-h-tap w-full items-center px-sm text-left ${i === pick ? 'bg-surface-raised' : ''}`}
              >
                @{m.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <AttachmentChips files={attachments.files} onRemove={attachments.remove} />
      <div className="flex items-end gap-xs">
        {attach && (
          <>
            <input
              ref={picker}
              type="file"
              multiple
              accept={ACCEPT}
              hidden
              onChange={(e) => {
                setFailure(attachments.add(e.target.files))
                e.target.value = ''
              }}
            />
            <button
              type="button"
              aria-label="Attach files"
              disabled={attachments.files.length >= MAX_FILES}
              onClick={() => picker.current?.click()}
              className="press inline-flex size-tap shrink-0 items-center justify-center rounded-pill text-accent disabled:text-ink-disabled"
            >
              <Paperclip size={20} aria-hidden />
            </button>
          </>
        )}
        <label className="sr-only" htmlFor={onCancel ? 'edit-message' : 'new-message'}>
          {onCancel ? 'Edit your message' : 'Message'}
        </label>
        <textarea
          id={onCancel ? 'edit-message' : 'new-message'}
          ref={box}
          rows={onCancel ? 3 : 2}
          maxLength={4000}
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value)
            setCaret(e.target.selectionStart)
            setPick(0)
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 resize-y rounded-sm border border-hairline bg-surface px-md py-sm text-ink placeholder:text-ink-secondary focus-visible:border-focus"
        />
        {!onCancel && (
          <Button type="submit" disabled={!canSend} icon={busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : <Send size={18} aria-hidden />}>
            Send
          </Button>
        )}
      </div>
      {onCancel && (
        <div className="flex gap-xs">
          <Button type="submit" variant="secondary" disabled={busy || !text.trim()}>
            {submitLabel}
          </Button>
          <Button variant="plain" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
      {failure && (
        <p role="alert" className="text-caption text-critical">
          {failure}
        </p>
      )}
    </form>
  )
}

function MessageRow({
  m,
  org,
  ws,
  channel,
  onChanged,
}: {
  m: WsMessage
  org: Org
  ws: Workspace
  channel: WsChannel
  onChanged: (m: WsMessage) => void
}) {
  const me = useUser()!
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const mine = m.author?.id === me.id
  const canDelete = !m.deleted && (mine || (channel.kind === 'channel' && canManage(ws.role)))
  const canEdit = !m.deleted && mine && ws.role !== 'guest' && !!m.body

  return (
    <li className="group flex flex-col gap-xxs rounded-sm px-sm py-xs hover:bg-canvas-alt">
      <p className="text-caption">
        <span className="font-semibold">{m.author?.name ?? 'Someone who left'}</span>
        <span className="text-ink-secondary">
          {' · '}
          {formatDate(m.created_at)}
          {m.edited_at && !m.deleted ? ' · edited' : ''}
        </span>
      </p>
      {m.deleted ? (
        <p className="text-caption italic text-ink-secondary">This message was deleted.</p>
      ) : editing ? (
        <Composer
          members={ws.members}
          initial={toEditable(m.body, ws.members)}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={async (stored) => {
            onChanged(await workspaceApi.edit(org.id, m.id, stored))
            setEditing(false)
          }}
        />
      ) : (
        <>
          {m.body && <Body body={m.body} members={ws.members} me={me.id} />}
          {m.files.length > 0 && <FileList orgId={org.id} files={m.files} />}
        </>
      )}
      {!editing && (canEdit || canDelete) && (
        <div className="flex gap-sm text-caption">
          {confirm ? (
            <>
              <span>Delete this message?</span>
              <button type="button" className="press text-critical" onClick={() => void workspaceApi.remove(org.id, m.id).then(() => onChanged({ ...m, deleted: true, body: '' }))}>
                Delete
              </button>
              <button type="button" className="press text-accent" onClick={() => setConfirm(false)}>
                Keep
              </button>
            </>
          ) : (
            <>
              {canEdit && (
                <button type="button" className="press text-accent" onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
              {canDelete && (
                <button type="button" className="press text-accent" onClick={() => setConfirm(true)}>
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      )}
    </li>
  )
}

/** Start or join the channel's huddle. The call opens full screen. */
function HuddleButton({ org, ws, channel, onChanged }: { org: Org; ws: Workspace; channel: WsChannel; onChanged: () => void }) {
  const cfg = useCallsConfig()
  const [pass, setPass] = useState<CallPass | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const on = channel.huddle
  if (!cfg?.enabled || (!on && ws.role === 'guest')) return null

  async function open() {
    setBusy(true)
    setError(null)
    try {
      setPass(await callsApi.huddle(org.id, channel.id))
    } catch (err) {
      setError(err instanceof ApiError && err.detail ? err.detail : 'The huddle didn’t open. Check your connection, then try again.')
    } finally {
      setBusy(false)
    }
  }

  function closed(reason: LeaveReason) {
    if (pass && reason !== 'ended') void callsApi.leave(org.id, pass.call.id).catch(() => {})
    if (reason === 'failed') setError('You were disconnected from the huddle. Join again to go back in.')
    setPass(null)
    onChanged()
  }

  const n = on?.people.length ?? 0
  return (
    <div className="flex shrink-0 flex-col items-end">
      <Button
        variant={on ? 'primary' : 'secondary'}
        disabled={busy}
        icon={busy ? <LoaderCircle size={16} className="animate-spin" aria-hidden /> : <Headphones size={16} aria-hidden />}
        onClick={() => void open()}
      >
        {on ? (n ? `Join huddle (${n})` : 'Join huddle') : 'Start huddle'}
      </Button>
      {error && (
        <p role="alert" className="max-w-64 text-right text-caption text-critical">
          {error}
        </p>
      )}
      {pass && (
        <Call
          pass={pass}
          title={`Huddle in ${channelLabel(channel)}`}
          start="voice"
          screenShare
          onLeave={closed}
          onEndForAll={canManage(ws.role) ? () => callsApi.end(org.id, pass.call.id) : undefined}
        />
      )}
    </div>
  )
}

function ChannelView({
  org,
  ws,
  channel,
  onBack,
  onRead,
  onArchived,
  onHuddle,
}: {
  org: Org
  ws: Workspace
  channel: WsChannel
  onBack: () => void
  onRead: () => void
  onArchived: () => void
  onHuddle: () => void
}) {
  const [list, setList] = useState<WsMessage[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [more, setMore] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const cursor = useRef<string | null>(null)
  const scroller = useRef<HTMLOListElement>(null)
  const stick = useRef(true)

  const merge = useCallback((incoming: WsMessage[], prepend = false) => {
    setList((prev) => {
      const byId = new Map((prev ?? []).map((m) => [m.id, m]))
      for (const m of incoming) byId.set(m.id, m)
      const all = [...byId.values()]
      all.sort((a, b) => a.created_at.localeCompare(b.created_at))
      return prepend || incoming.length || !prev ? all : prev
    })
  }, [])

  const read = useCallback(() => {
    onRead()
    window.dispatchEvent(new Event(WORKSPACE_READ))
  }, [onRead])

  useEffect(() => {
    const controller = new AbortController()
    workspaceApi
      .messages(org.id, channel.id, {}, controller.signal)
      .then((res) => {
        cursor.current = res.cursor
        setMore(res.messages.length >= 100)
        merge(res.messages)
        read()
      })
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') setFailed(true)
      })
    return () => controller.abort()
  }, [org.id, channel.id, merge, read])

  useVisibleInterval(
    () => {
      if (!cursor.current) return
      workspaceApi
        .messages(org.id, channel.id, { since: cursor.current })
        .then((res) => {
          cursor.current = res.cursor
          if (res.messages.length) {
            merge(res.messages)
            read()
          }
        })
        .catch(() => {
          // Try again on the next tick
        })
    },
    POLL_MESSAGES_MS,
    list !== null,
  )

  // Keep the newest message in view, unless you've scrolled up to read older ones
  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [list])

  async function older() {
    const first = list?.[0]
    if (!first) return
    const res = await workspaceApi.messages(org.id, channel.id, { before: first.created_at })
    setMore(res.messages.length >= 100)
    stick.current = false
    merge(res.messages, true)
  }

  const canPost = ws.role !== 'guest'
  const label = channelLabel(channel)
  const filesOn = useFilesOn()

  return (
    <section aria-label={label} className="flex min-h-[60dvh] min-w-0 flex-col rounded-lg border border-hairline bg-surface">
      <header className="flex items-center gap-sm border-b border-hairline px-md py-sm">
        <button type="button" onClick={onBack} aria-label="All channels" className="press -ml-xs inline-flex size-tap items-center justify-center rounded-pill text-accent md:hidden">
          <ChevronLeft size={20} aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{label}</h2>
          {channel.topic && <p className="truncate text-caption text-ink-secondary">{channel.topic}</p>}
          {channel.huddle && channel.huddle.people.length > 0 && (
            <p className="truncate text-caption text-positive">In the huddle: {channel.huddle.people.join(', ')}</p>
          )}
        </div>
        <HuddleButton org={org} ws={ws} channel={channel} onChanged={onHuddle} />
        {channel.kind === 'channel' && channel.name !== 'general' && canManage(ws.role) && (
          <Button
            variant="plain"
            disabled={archiving}
            icon={<Archive size={16} aria-hidden />}
            onClick={async () => {
              setArchiving(true)
              try {
                await workspaceApi.updateChannel(org.id, channel.id, { archived: true })
                onArchived()
              } catch {
                setArchiving(false)
              }
            }}
          >
            Archive
          </Button>
        )}
      </header>
      <ol
        ref={scroller}
        aria-label="Messages"
        aria-live="polite"
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="flex max-h-[60dvh] flex-1 flex-col gap-xxs overflow-y-auto p-sm"
      >
        {failed && !list ? (
          <li className="p-md text-ink-secondary">We couldn't load these messages. Check your connection, then reload the page.</li>
        ) : !list ? (
          <li aria-busy className="flex flex-col gap-sm p-sm">
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-10 w-1/2" />
          </li>
        ) : (
          <>
            {more && (
              <li className="self-center">
                <Button variant="plain" onClick={() => void older()}>
                  Show earlier messages
                </Button>
              </li>
            )}
            {list.length === 0 && (
              <li className="p-md text-ink-secondary">
                {channel.kind === 'dm' ? `This is the start of your messages with ${label}.` : `This is the start of ${label}. Say hello.`}
              </li>
            )}
            {list.map((m) => (
              <MessageRow key={m.id} m={m} org={org} ws={ws} channel={channel} onChanged={(next) => merge([next])} />
            ))}
          </>
        )}
      </ol>
      <div className="border-t border-hairline p-sm">
        {canPost ? (
          <Composer
            members={ws.members}
            placeholder={`Message ${label}`}
            submitLabel="Send"
            onSubmit={async (stored, fileIds) => {
              stick.current = true
              merge([await workspaceApi.post(org.id, channel.id, stored, fileIds)])
            }}
            attach={filesOn ? (file, mime, onProgress) => workspaceApi.attach(org.id, channel.id, file, mime, onProgress) : undefined}
          />
        ) : (
          <p className="p-xs text-caption text-ink-secondary">Guests can read the workspace but can’t post.</p>
        )}
      </div>
    </section>
  )
}

function OrgWorkspace({ org, orgs }: { org: Org; orgs: Org[] }) {
  const [params, setParams] = useSearchParams()
  const [ws, setWs] = useState<Workspace | null>(null)
  const [failed, setFailed] = useState(false)
  const [archived, setArchived] = useState<string | null>(null)
  const current = params.get('c')

  const load = useCallback(
    (pick?: string) =>
      workspaceApi
        .load(org.id)
        .then((data) => {
          setWs(data)
          setFailed(false)
          if (pick) setParams({ c: pick })
        })
        .catch(() => setFailed(true)),
    [org.id, setParams],
  )

  useEffect(() => {
    void load()
  }, [load])
  useVisibleInterval(() => void load(), POLL_CHANNELS_MS)

  const channel = ws?.channels.find((c) => c.id === current) ?? null
  // On wide screens, open #general when nothing is picked; phones start on the list
  const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
  const shown = channel ?? (wide ? (ws?.channels.find((c) => c.name === 'general') ?? null) : null)

  const shownId = shown?.id
  const markRead = useCallback(() => {
    if (!shownId) return
    setWs((w) => (w ? { ...w, channels: w.channels.map((c) => (c.id === shownId ? { ...c, unread: 0, mentions: 0 } : c)) } : w))
  }, [shownId])

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex flex-col gap-md sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-xxs">
          <h1 className="text-display-md">Team chat</h1>
          <p className="text-ink-secondary">{org.name}</p>
        </div>
        <OrgSwitcher orgs={orgs} current={org} />
      </header>
      {archived && (
        <Banner tone="positive" title={`Archived #${archived}`} onDismiss={() => setArchived(null)}>
          Nobody can post in it now. Its messages stay saved.
        </Banner>
      )}
      {failed && !ws ? (
        <LoadFailed what="your team chat" onRetry={() => void load()} />
      ) : !ws ? (
        <div aria-busy className="grid gap-md md:grid-cols-[16rem_minmax(0,1fr)]">
          <p role="status" className="sr-only">
            Loading your team chat.
          </p>
          <Skeleton className="h-64 rounded-lg" />
          <Skeleton className="h-96 rounded-lg" />
        </div>
      ) : (
        <div className="grid gap-md md:grid-cols-[16rem_minmax(0,1fr)]">
          <div className={shown ? 'hidden md:block' : ''}>
            <Sidebar org={org} ws={ws} current={shown?.id ?? null} onPick={(id) => setParams({ c: id })} onChanged={(pick) => void load(pick)} />
          </div>
          {shown ? (
            <ChannelView
              key={shown.id}
              org={org}
              ws={ws}
              channel={shown}
              onBack={() => setParams({})}
              onRead={markRead}
              onArchived={() => {
                setArchived(shown.name)
                setParams({})
                void load()
              }}
              onHuddle={() => void load()}
            />
          ) : (
            <div className="hidden items-center justify-center rounded-lg border border-dashed border-hairline p-xl text-ink-secondary md:flex">
              <p className="inline-flex items-center gap-xs">
                <MessageSquarePlus size={18} aria-hidden />
                Pick a channel or a teammate.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** /business/workspace: team channels and direct messages for a business account */
export function WorkspacePage() {
  const user = useUser()
  const { pathname } = useLocation()
  const { orgs, failed, reload } = useMyOrgs()
  const org = useCurrentOrg(orgs)

  if (!user) return <SignInFor from={pathname} title="Sign in to see your team chat" />
  if (orgs && !org) return <NoOrgYet />

  return (
    <div className="gutter mx-auto flex max-w-grid flex-col gap-lg py-xxl">
      {failed && !orgs ? (
        <LoadFailed what="your business accounts" onRetry={reload} />
      ) : !org || !orgs ? (
        <div aria-busy className="flex flex-col gap-sm">
          <p role="status" className="sr-only">
            Loading your team chat.
          </p>
          <Skeleton className="h-12 w-1/3" />
          <Skeleton className="h-96 w-full rounded-lg" />
        </div>
      ) : (
        <OrgWorkspace key={org.id} org={org} orgs={orgs} />
      )}
    </div>
  )
}
