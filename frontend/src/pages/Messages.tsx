import { useEffect, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, FileQuestion, MessagesSquare, RotateCw, UserRound } from 'lucide-react'
import { ApiError, MESSAGES_READ, messagesApi, type Thread, type ThreadDetail } from '../lib/api'
import { useUser } from '../lib/auth'
import { formatDate } from '../lib/format'
import { Button, ButtonLink } from '../components/Button'
import { BuyerCalls } from '../components/BuyerCalls'
import { Conversation } from '../components/Conversation'
import { EmptyState, Skeleton } from '../components/States'
import { LoadFailed } from './business/Shared'

function SignInForMessages({ from }: { from: string }) {
  return (
    <EmptyState
      as="h1"
      icon={UserRound}
      title="Sign in to see your messages"
      body="Messages you send to sellers while signed in, and their replies, show up here."
      action={
        <ButtonLink to="/account" state={{ from }}>
          Sign in
        </ButtonLink>
      }
    />
  )
}

/** /messages: your conversations with sellers */
export function MessagesPage() {
  const user = useUser()
  const { pathname } = useLocation()
  const [state, setState] = useState<{ userId: string; threads: Thread[] | null; failed: boolean } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!user) return
    const controller = new AbortController()
    messagesApi
      .list(controller.signal)
      .then((threads) => setState({ userId: user.id, threads, failed: false }))
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') setState({ userId: user.id, threads: null, failed: true })
      })
    return () => controller.abort()
  }, [user, attempt])

  if (!user) return <SignInForMessages from={pathname} />
  const current = state?.userId === user.id ? state : null

  return (
    <div className="gutter mx-auto flex max-w-reading flex-col gap-lg py-xxl sm:py-section">
      <header className="flex flex-col gap-xxs">
        <h1 className="text-display-md">Messages</h1>
        <p className="text-ink-secondary">Your conversations with sellers about their listings.</p>
      </header>
      {current?.failed ? (
        <LoadFailed what="your messages" onRetry={() => setAttempt((n) => n + 1)} />
      ) : !current?.threads ? (
        <div aria-busy className="flex flex-col gap-sm">
          <p role="status" className="sr-only">
            Loading your messages.
          </p>
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      ) : current.threads.length === 0 ? (
        <EmptyState
          icon={MessagesSquare}
          title="No messages yet"
          body="Open a listing and tap “Message the seller”. Their replies show up here."
          action={<ButtonLink to="/listings">Find listings</ButtonLink>}
        />
      ) : (
        <ul className="flex flex-col gap-xs">
          {current.threads.map((t) => (
            <li key={t.id}>
              <Link
                to={`/messages/${t.id}`}
                className="press flex min-h-tap items-center gap-md rounded-lg border border-hairline bg-surface p-md hover:bg-surface-raised"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-xs">
                    <span className="truncate font-semibold">{t.listing?.title ?? 'A listing that was removed'}</span>
                    {t.unread > 0 && <span className="shrink-0 rounded-pill bg-accent-fill px-xs text-caption text-on-accent">{t.unread} new</span>}
                  </span>
                  <span className="block truncate text-caption text-ink-secondary">
                    {t.seller} · {formatDate(t.last_message_at)}
                  </span>
                  {t.last_message && <span className="block truncate text-caption text-ink-secondary">{t.last_message}</span>}
                </span>
                <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-ink-secondary" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** /messages/:id: one conversation with a seller */
export function ThreadPage() {
  const { id = '' } = useParams()
  const user = useUser()
  const { pathname } = useLocation()
  const [loaded, setLoaded] = useState<{ id: string; thread: ThreadDetail } | null>(null)
  const [failure, setFailure] = useState<{ id: string; err: unknown } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!user) return
    const controller = new AbortController()
    messagesApi
      .get(id, controller.signal)
      .then((thread) => {
        setLoaded({ id, thread })
        window.dispatchEvent(new Event(MESSAGES_READ))
      })
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') setFailure({ id, err })
      })
    return () => controller.abort()
  }, [id, user, attempt])

  if (!user) return <SignInForMessages from={pathname} />
  const thread = loaded?.id === id ? loaded.thread : null
  const err = failure?.id === id ? failure.err : null

  if (!thread && err) {
    const gone = err instanceof ApiError && err.kind === 'not-found'
    return (
      <EmptyState
        as="h1"
        icon={FileQuestion}
        title={gone ? 'This conversation isn’t here' : "We couldn't load this conversation"}
        body={gone ? 'The seller deleted it, or you’re signed in with another account.' : 'Check your connection, then try again.'}
        action={
          gone ? (
            <ButtonLink to="/messages">See your messages</ButtonLink>
          ) : (
            <Button onClick={() => setAttempt((n) => n + 1)} icon={<RotateCw size={18} aria-hidden />}>
              Try again
            </Button>
          )
        }
      />
    )
  }

  if (!thread) {
    return (
      <div aria-busy className="gutter mx-auto flex max-w-reading flex-col gap-md py-xxl">
        <p role="status" className="sr-only">
          Loading the conversation.
        </p>
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    )
  }

  return (
    <div className="gutter mx-auto flex max-w-reading flex-col gap-lg py-xl">
      <Link to="/messages" className="press -ml-xs inline-flex min-h-tap items-center gap-xxs self-start px-xs text-accent">
        <ChevronLeft size={20} aria-hidden />
        Messages
      </Link>
      <header className="flex flex-col gap-xxs">
        <h1 className="text-display-md">{thread.seller}</h1>
        {thread.listing ? (
          <Link to={`/listing/${thread.listing.id}`} className="self-start text-accent">
            {thread.listing.title}
          </Link>
        ) : (
          <p className="text-ink-secondary">The seller removed this listing.</p>
        )}
      </header>
      <BuyerCalls threadId={id} seller={thread.seller} listing={thread.listing} onChanged={() => setAttempt((n) => n + 1)} />
      <section aria-label="Conversation" className="rounded-lg border border-hairline bg-surface p-md sm:p-lg">
        <Conversation
          messages={thread.messages}
          me="buyer"
          names={(m) => m.author ?? thread.seller}
          placeholder={`Message ${thread.seller}`}
          onSend={async (text) => setLoaded({ id, thread: await messagesApi.send(id, text) })}
        />
      </section>
      <p className="text-caption text-ink-secondary">
        SmartLand doesn’t check sellers’ IDs. Never send money before you’ve seen the property and the title.
      </p>
    </div>
  )
}
