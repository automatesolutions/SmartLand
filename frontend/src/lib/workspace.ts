import { useEffect, useRef } from 'react'
import type { WsChannel, WsMember } from './api'

/** Fired on window when you read a channel, so the nav badge counts again */
export const WORKSPACE_READ = 'smartland:workspace-read'

/** "#general", or the other person's name for a DM */
export function channelLabel(c: WsChannel): string {
  return c.kind === 'dm' ? (c.with?.name ?? 'Someone who left') : `#${c.name}`
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** "@Ana Cruz can you call?" → "<@id> can you call?" for every teammate named. Longest names first,
 * so "@Ana Cruz" wins over "@Ana". */
export function toStored(text: string, members: WsMember[]): string {
  let out = text
  for (const m of [...members].sort((a, b) => b.name.length - a.name.length)) {
    out = out.replace(new RegExp(`@${escape(m.name)}(?![\\w])`, 'g'), `<@${m.id}>`)
  }
  return out
}

/** The reverse, for editing a message you sent */
export function toEditable(body: string, members: WsMember[]): string {
  return body.replace(/<@([\w-]+)>/g, (whole, id: string) => {
    const m = members.find((x) => x.id === id)
    return m ? `@${m.name}` : whole
  })
}

/** Splits a stored body into text and mentions, for showing */
export function mentionParts(body: string): ({ text: string } | { mention: string })[] {
  return body.split(/(<@[\w-]+>)/).flatMap((part): ({ text: string } | { mention: string })[] => {
    if (!part) return []
    const m = /^<@([\w-]+)>$/.exec(part)
    return [m ? { mention: m[1] } : { text: part }]
  })
}

/** Runs `fn` every `ms` while the tab is visible, and once right away when it becomes visible again */
export function useVisibleInterval(fn: () => void, ms: number, enabled = true) {
  const saved = useRef(fn)
  useEffect(() => {
    saved.current = fn
  })
  useEffect(() => {
    if (!enabled) return
    let timer: number | undefined
    const start = () => {
      window.clearInterval(timer)
      if (document.visibilityState === 'visible') timer = window.setInterval(() => saved.current(), ms)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') saved.current()
      start()
    }
    start()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [ms, enabled])
}
