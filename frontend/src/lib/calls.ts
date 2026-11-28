import { useEffect, useState } from 'react'
import { callsApi, type CallsConfig } from './api'

// Asked once per page load: whether huddles and live tours are on, and their limits
let cached: Promise<CallsConfig> | null = null

/** Null while loading. If the check fails, calls show as off. */
export function useCallsConfig(): CallsConfig | null {
  const [cfg, setCfg] = useState<CallsConfig | null>(null)
  useEffect(() => {
    let live = true
    cached ??= callsApi.config().catch(() => {
      cached = null
      return { enabled: false, max_minutes: 60, huddle_people: 6, tour_people: 4 }
    })
    void cached.then((c) => live && setCfg(c))
    return () => {
      live = false
    }
  }, [])
  return cfg
}

/** 125 seconds → "2:05" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
