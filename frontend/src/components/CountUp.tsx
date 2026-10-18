import { useEffect, useRef } from 'react'
import { gsap } from 'gsap'
// Registers the "apple" ease
import '../lib/motion'

/**
 * A number that counts up when it first appears and rolls to each new value.
 * It renders the final text from the start, so print, screen readers, and
 * reduced motion always see the real number.
 */
export function CountUp({
  value,
  format,
  className = '',
}: {
  value: number
  format: (n: number) => string
  className?: string
}) {
  const el = useRef<HTMLSpanElement>(null)
  const shown = useRef(0)
  const formatRef = useRef(format)

  useEffect(() => {
    formatRef.current = format
  }, [format])

  useEffect(() => {
    const node = el.current
    if (!node) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      shown.current = value
      node.textContent = formatRef.current(value)
      return
    }
    const state = { n: shown.current }
    const tween = gsap.to(state, {
      n: value,
      duration: 0.9,
      ease: 'apple',
      onUpdate: () => {
        shown.current = state.n
        node.textContent = formatRef.current(state.n)
      },
    })
    return () => {
      tween.kill()
    }
  }, [value])

  return (
    <span ref={el} className={`tabular-nums ${className}`}>
      {format(value)}
    </span>
  )
}
