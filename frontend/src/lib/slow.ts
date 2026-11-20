import { useEffect, useState } from 'react'

/**
 * True once `active` has stayed true for `ms`, so a wait that runs long can say
 * so instead of spinning quietly. Resets when `active` turns false.
 */
export function useSlow(active: boolean, ms = 8000): boolean {
  const [slowSince, setSlowSince] = useState<number | null>(null)

  useEffect(() => {
    if (!active) return
    const timer = window.setTimeout(() => setSlowSince(Date.now()), ms)
    return () => {
      window.clearTimeout(timer)
      setSlowSince(null)
    }
  }, [active, ms])

  return active && slowSince !== null
}
