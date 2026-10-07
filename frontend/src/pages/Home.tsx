import { useRef } from 'react'
import { ButtonLink } from '../components/Button'
import { GRADE_ORDER, gradeInfo } from '../lib/format'
import { useReveal } from '../lib/motion'

const OUTPUTS = [
  { sample: '₱4,350', title: 'Price per sqm', body: 'An estimate in pesos, plus the total for your lot size.' },
  { sample: '78', title: 'Growth score', body: 'From 0 to 100. How strongly local conditions point to rising prices.' },
  { sample: 'A to B+', title: 'Investment grade', body: 'A+ to C-, with the reasons behind it and the risks to check.' },
]

const STEPS = [
  { n: '01', title: 'Enter the location', body: 'Any city, town, or barangay in the Philippines.' },
  { n: '02', title: 'Add what you know', body: 'Roads, flood risk, and how far the mall, school, and hospital are.' },
  { n: '03', title: 'Read the report', body: 'See the price, growth score, and grade. Save it to compare lots.' },
]

export function HomePage() {
  const pageRef = useRef<HTMLDivElement>(null)
  useReveal(pageRef)

  return (
    <div ref={pageRef}>
      <section className="flex min-h-[calc(100dvh-var(--spacing-nav))] flex-col bg-canvas">
        <div className="gutter mx-auto flex w-full max-w-reading flex-col items-center gap-md pt-xxl text-center sm:pt-section">
          <h1 data-reveal className="text-display-md xs:text-display-lg lg:text-hero">
            Know what land is worth before you buy.
          </h1>
          <p data-reveal className="max-w-prose text-lead font-regular">
            A price per sqm, a growth score, and a grade for any city or town.
          </p>
          <div data-reveal className="flex flex-col items-stretch gap-sm pt-xs xs:flex-row xs:items-center">
            <ButtonLink to="/check">Check a location</ButtonLink>
            <ButtonLink to="/reports" variant="secondary">
              See saved reports
            </ButtonLink>
          </div>
        </div>
        <div className="mt-xl flex min-h-[42vh] flex-1 sm:mt-xxl sm:min-h-[52vh]">
          <img
            src="/img/hero-land.jpg"
            alt="Aerial view of farm lots, houses, and coconut palms on both sides of a provincial road"
            width={1344}
            height={576}
            fetchPriority="high"
            className="block w-full object-cover"
          />
        </div>
      </section>

      <section id="outputs" aria-labelledby="outputs-title" className="bg-tile py-xxl text-on-tile sm:py-section">
        <div className="gutter mx-auto flex max-w-reading flex-col items-center gap-sm text-center">
          <h2 id="outputs-title" data-reveal className="text-display-md sm:text-display-lg">
            Three numbers for every lot.
          </h2>
          <p data-reveal className="text-lead font-regular text-on-tile-secondary">
            The same three figures on every report, so lots sit side by side.
          </p>
          <div data-reveal className="flex flex-col items-stretch gap-sm pt-md xs:flex-row">
            <ButtonLink to="/check">Check a location</ButtonLink>
            <ButtonLink to="/reports" variant="on-tile">
              See saved reports
            </ButtonLink>
          </div>
        </div>
        <ul className="gutter mx-auto mt-xxl grid max-w-grid gap-xxl text-center md:grid-cols-3">
          {OUTPUTS.map((item, i) => (
            <li key={item.title} data-reveal data-reveal-delay={i * 0.08} className="flex flex-col gap-sm">
              <p className="text-display-lg tabular-nums lg:text-hero">{item.sample}</p>
              <h3 className="text-tagline font-semibold">{item.title}</h3>
              <p className="text-on-tile-secondary">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="grid md:grid-cols-2">
        <div className="bg-canvas-alt py-xxl text-center sm:py-section">
          <div data-reveal className="gutter mx-auto flex max-w-prose flex-col items-center gap-md">
            <p className="text-tagline font-semibold">Growth score</p>
            <p className="text-display-lg lg:text-hero">0 to 100</p>
            <p className="text-lead font-regular text-ink-secondary">How strongly the area points to rising prices.</p>
            <ButtonLink to="/check">Check a location</ButtonLink>
          </div>
        </div>
        <div className="bg-tile-2 py-xxl text-center text-on-tile sm:py-section">
          <div data-reveal className="gutter mx-auto flex max-w-prose flex-col items-center gap-md">
            <p className="text-tagline font-semibold">Investment grade</p>
            <p className="text-display-lg lg:text-hero">A+ to C-</p>
            <p className="text-lead font-regular text-on-tile-secondary">Clear reasons. The risks sit next to the score.</p>
            <ButtonLink to="/#grades" variant="on-tile">
              See the grades
            </ButtonLink>
          </div>
        </div>
      </section>

      <section id="how" aria-labelledby="how-title" className="bg-canvas py-xxl sm:py-section">
        <div className="gutter mx-auto flex max-w-grid flex-col gap-xxl">
          <div data-reveal className="mx-auto flex max-w-reading flex-col items-center gap-sm text-center">
            <h2 id="how-title" className="text-display-md sm:text-display-lg">
              How it works
            </h2>
            <p className="text-lead font-regular text-ink-secondary">Three steps. Then a report you can save.</p>
          </div>
          <ol className="grid gap-xxl md:grid-cols-3">
            {STEPS.map((step, i) => (
              <li key={step.n} data-reveal data-reveal-delay={i * 0.08} className="flex flex-col items-center gap-md text-center">
                <p className="text-caption font-semibold text-ink-secondary">{step.n}</p>
                <h3 className="text-tagline font-semibold">{step.title}</h3>
                <p className="max-w-prose text-ink-secondary">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="grades" aria-labelledby="grades-title" className="bg-canvas-alt py-xxl sm:py-section">
        <div className="gutter mx-auto flex max-w-reading flex-col items-center gap-xxl text-center">
          <div data-reveal className="flex flex-col gap-sm">
            <h2 id="grades-title" className="text-display-md sm:text-display-lg">
              Four grades. Clear reasons.
            </h2>
            <p className="text-lead font-regular text-ink-secondary">Every report explains what pushed the grade up or down.</p>
          </div>
          <ul className="grid w-full gap-xxl sm:grid-cols-2">
            {GRADE_ORDER.map((g, i) => {
              const info = gradeInfo(g)
              return (
                <li key={g} data-reveal data-reveal-delay={i * 0.06} className="flex flex-col gap-sm">
                  <p className="text-display-lg lg:text-hero">{info.grade}</p>
                  <p className="text-tagline font-semibold">{info.label}</p>
                  <p className="text-ink-secondary">{info.summary}</p>
                </li>
              )
            })}
          </ul>
        </div>
      </section>

      <section className="bg-tile py-xxl text-center text-on-tile sm:py-section">
        <div data-reveal className="gutter mx-auto flex max-w-reading flex-col items-center gap-md">
          <h2 className="text-display-md sm:text-display-lg">Have a lot in mind?</h2>
          <p className="text-lead font-regular text-on-tile-secondary">Check a city, town, or barangay. The report takes a few seconds.</p>
          <div className="flex flex-col items-stretch gap-sm pt-xs xs:flex-row">
            <ButtonLink to="/check">Check a location</ButtonLink>
            <ButtonLink to="/reports" variant="on-tile">
              See saved reports
            </ButtonLink>
          </div>
        </div>
      </section>
    </div>
  )
}
