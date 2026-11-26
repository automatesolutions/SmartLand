import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LoaderCircle, Send } from 'lucide-react'
import { ApiError, type Message } from '../lib/api'
import { formatDate } from '../lib/format'
import { Button } from './Button'

/** Messages between a buyer and a seller's team. `me` is the side you're on: your messages sit on the right. */
export function Conversation({
  messages,
  me,
  names,
  onSend,
  placeholder,
}: {
  messages: Message[]
  me: Message['sender']
  /** How to label the other side's messages */
  names: (m: Message) => string
  /** Leave out to show the thread read-only */
  onSend?: (text: string) => Promise<void>
  placeholder?: string
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const end = useRef<HTMLLIElement>(null)

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [messages.length])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!onSend || !text.trim()) return
    setBusy(true)
    setFailure(null)
    try {
      await onSend(text.trim())
      setText('')
    } catch (err) {
      setFailure(
        err instanceof ApiError && err.kind === 'rate-limited'
          ? 'You’ve sent a lot of messages in a short time. Wait a while, then try again.'
          : err instanceof ApiError && err.detail && err.kind === 'conflict'
            ? err.detail
            : 'Check your connection, then try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-md">
      <ol aria-label="Messages" className="flex max-h-[28rem] flex-col gap-sm overflow-y-auto">
        {messages.map((m) => {
          const mine = m.sender === me
          return (
            <li key={m.id} className={`flex max-w-[85%] flex-col gap-xxs ${mine ? 'items-end self-end' : 'items-start self-start'}`}>
              <p className="text-caption text-ink-secondary">
                {mine ? (m.sender === 'team' && m.author ? m.author : 'You') : names(m)} · {formatDate(m.created_at)}
              </p>
              <p className={`whitespace-pre-line rounded-lg px-md py-sm ${mine ? 'bg-accent-fill text-on-accent' : 'bg-surface-raised'}`}>{m.body}</p>
            </li>
          )
        })}
        <li ref={end} aria-hidden />
      </ol>
      {onSend && (
        <form onSubmit={submit} aria-busy={busy} className="flex flex-col gap-xs">
          <label htmlFor="reply" className="sr-only">
            Your message
          </label>
          <div className="flex items-end gap-xs">
            <textarea
              id="reply"
              rows={2}
              value={text}
              maxLength={2000}
              placeholder={placeholder}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter adds a line
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  e.currentTarget.form?.requestSubmit()
                }
              }}
              className="min-w-0 flex-1 resize-y rounded-sm border border-hairline bg-surface px-md py-sm text-ink placeholder:text-ink-secondary focus-visible:border-focus"
            />
            <Button
              type="submit"
              disabled={busy || !text.trim()}
              icon={busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : <Send size={18} aria-hidden />}
            >
              Send
            </Button>
          </div>
          {failure && (
            <p role="alert" className="text-caption text-critical">
              Your message didn't send. {failure}
            </p>
          )}
        </form>
      )}
    </div>
  )
}
