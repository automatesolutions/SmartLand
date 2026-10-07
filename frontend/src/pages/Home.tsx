import { useRef } from 'react'
import { ArrowRight, ChartNoAxesColumn, MapPin, SlidersHorizontal, FileText, Tag, TrendingUp } from 'lucide-react'
import { ButtonLink } from '../components/Button'
import { GradeBadge } from '../components/Grade'
import { ParcelMap } from '../components/ParcelMap'
import { GRADE_ORDER, gradeInfo } from '../lib/format'
import { useReveal } from '../lib/motion'

const OUTPUTS = [
  { icon: Tag, title: 'Price per sqm', body: 'An estimate in pesos, plus the total for your lot size.', sample: '₱4,350 / sqm' },
  { icon: TrendingUp, title: 'Growth score', body: 'From 0 to 100. How strongly the area points to rising prices.', sample: '78 of 100' },
  { icon: ChartNoAxesColumn, title: 'Investment grade', body: 'A+ to C-, with the reasons behind it and the risks to check.', sample: 'A to B+' },
]

const STEPS = [
  { icon: MapPin, title: 'Enter the location', body: 'Any city, town, or barangay in the Philippines.' },
  { icon: SlidersHorizontal, title: 'Add what you know', body: 'Roads, flood risk, and how far the mall, school, and hospital are. Sample values help you start.' },
  { icon: FileText, title: 'Read the report', body: 'See the price, growth score, and grade. Save it to compare with other lots.' },
]

export function HomePage() {
  const pageRef = useRef<HTMLDivElement>(null)
  useReveal(pageRef)

  return (
    <div ref={pageRef}>
      {/* Hero: light tile */}
      <section className="bg-canvas">
        <div className="gutter mx-auto flex max-w-grid flex-col items-center gap-xl pb-xxl pt-xxl text-center sm:pt-section">
          <div className="flex max-w-reading flex-col items-center gap-md">
            <p data-reveal className="text-caption font-semibold text-ink-secondary">
              Land prices across the Philippines
            </p>
            <h1 data-reveal className="text-display-sm xs:text-display-md sm:text-display-lg lg:text-hero">
              Know what land is worth before you buy.
            </h1>
            <p data-reveal className="max-w-prose text-body text-ink-secondary sm:text-lead-airy sm:font-light">
              Get a price per sqm, a growth score, and an investment grade for any city or town.
            </p>
            <div data-reveal className="flex w-full flex-col items-stretch gap-sm pt-xs xs:w-auto xs:flex-row xs:items-center">
              <ButtonLink to="/check" size="large" iconAfter={<ArrowRight size={20} aria-hidden />}>
                Check a location
              </ButtonLink>
              <ButtonLink to="/reports" variant="secondary" size="large">
                See saved reports
              </ButtonLink>
            </div>
          </div>
          <div data-reveal className="w-full max-w-reading">
            <ParcelMap />
          </div>
        </div>
      </section>

      {/* What you get: dark tile */}
      <section aria-labelledby="outputs-title" className="bg-tile text-on-tile">
        <div className="gutter mx-auto flex max-w-grid flex-col gap-xxl py-xxl sm:py-section">
          <div data-reveal className="mx-auto flex max-w-reading flex-col gap-sm text-center">
            <h2 id="outputs-title" className="text-display-sm sm:text-display-lg">
              Three numbers for every lot.
            </h2>
            <p className="text-on-tile-secondary sm:text-tagline sm:font-regular">
              Each report shows the same three numbers, so you can compare lots side by side.
            </p>
          </div>
          <ul className="grid gap-lg md:grid-cols-3">
            {OUTPUTS.map(({ icon: Icon, title, body, sample }, i) => (
              <li
                key={title}
                data-reveal
                data-reveal-delay={i * 0.08}
                className="flex flex-col gap-md rounded-lg border border-tile-hairline p-lg"
              >
                <Icon size={28} strokeWidth={1.5} className="text-on-tile-accent" aria-hidden />
                <div className="flex flex-col gap-xs">
                  <h3 className="text-tagline font-semibold">{title}</h3>
                  <p className="text-on-tile-secondary">{body}</p>
                </div>
                <p className="mt-auto text-display-sm tabular-nums">{sample}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* How it works: parchment tile */}
      <section id="how" aria-labelledby="how-title" className="bg-canvas-alt">
        <div className="gutter mx-auto flex max-w-grid flex-col gap-xxl py-xxl sm:py-section">
          <h2 id="how-title" data-reveal className="text-center text-display-sm sm:text-display-lg">
            How it works
          </h2>
          <ol className="grid gap-lg md:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, body }, i) => (
              <li
                key={title}
                data-reveal
                data-reveal-delay={i * 0.08}
                className="flex flex-col gap-md rounded-lg border border-hairline bg-surface p-lg"
              >
                <div className="flex items-center justify-between">
                  <Icon size={28} strokeWidth={1.5} className="text-accent" aria-hidden />
                  <span className="text-caption font-semibold text-ink-secondary">Step {i + 1}</span>
                </div>
                <div className="flex flex-col gap-xs">
                  <h3 className="text-tagline font-semibold">{title}</h3>
                  <p className="text-ink-secondary">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Grades: light tile */}
      <section aria-labelledby="grades-title" className="bg-canvas">
        <div className="gutter mx-auto flex max-w-reading flex-col gap-xxl py-xxl sm:py-section">
          <div data-reveal className="flex flex-col gap-sm text-center">
            <h2 id="grades-title" className="text-display-sm sm:text-display-lg">
              Four grades. Clear reasons.
            </h2>
            <p className="text-ink-secondary">Every report explains what pushed the grade up or down.</p>
          </div>
          <ul className="flex flex-col">
            {GRADE_ORDER.map((g, i) => {
              const info = gradeInfo(g)
              return (
                <li
                  key={g}
                  data-reveal
                  className={`flex flex-col gap-xs py-md sm:flex-row sm:items-center sm:gap-lg ${i > 0 ? 'border-t border-hairline' : ''}`}
                >
                  <div className="sm:w-56 sm:shrink-0">
                    <GradeBadge grade={info} />
                  </div>
                  <p className="text-ink-secondary">{info.summary}</p>
                </li>
              )
            })}
          </ul>
          <div data-reveal className="flex flex-col items-center gap-md text-center">
            <p className="text-tagline font-semibold">Have a lot in mind?</p>
            <ButtonLink to="/check" size="large" iconAfter={<ArrowRight size={20} aria-hidden />}>
              Check a location
            </ButtonLink>
          </div>
        </div>
      </section>
    </div>
  )
}
