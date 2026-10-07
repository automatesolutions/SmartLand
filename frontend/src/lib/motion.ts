import { useLayoutEffect, type RefObject } from 'react'
import { gsap } from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { CustomEase } from 'gsap/CustomEase'

gsap.registerPlugin(ScrollTrigger, CustomEase)

// DESIGN.md easing: cubic-bezier(0.25, 0.1, 0.25, 1)
CustomEase.create('apple', '0.25,0.1,0.25,1')

/**
 * Fades up every [data-reveal] element inside `scope` once, as it scrolls in.
 * Does nothing when the person prefers reduced motion.
 */
export function useReveal(scope: RefObject<HTMLElement | null>, deps: unknown[] = []) {
  useLayoutEffect(() => {
    if (!scope.current) return
    const mm = gsap.matchMedia()
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      const items = gsap.utils.toArray<HTMLElement>('[data-reveal]', scope.current)
      items.forEach((el) => {
        gsap.from(el, {
          autoAlpha: 0,
          y: 16,
          duration: 0.6,
          ease: 'apple',
          delay: Number(el.dataset.revealDelay ?? 0),
          scrollTrigger: { trigger: el, start: 'top 90%', once: true },
        })
      })
    })
    return () => mm.revert()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
