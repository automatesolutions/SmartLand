import { useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Bookmark, ChevronRight, Plus } from 'lucide-react'
import { useSavedReports } from '../lib/reports'
import { formatDate, formatPeso, parseGrade } from '../lib/format'
import { useReveal } from '../lib/motion'
import { ButtonLink } from '../components/Button'
import { GradeBadge } from '../components/Grade'
import { Banner, EmptyState } from '../components/States'

type Sort = 'newest' | 'price' | 'growth'

const SORTS: { value: Sort; label: string }[] = [
  { value: 'newest', label: 'Newest' },
  { value: 'growth', label: 'Growth score' },
  { value: 'price', label: 'Price' },
]

export function ReportsPage() {
  const reports = useSavedReports()
  const deleted = (useLocation().state as { deleted?: string } | null)?.deleted
  const [showDeleted, setShowDeleted] = useState(Boolean(deleted))
  const [sort, setSort] = useState<Sort>('newest')
  const pageRef = useRef<HTMLDivElement>(null)
  useReveal(pageRef, [reports.length])

  const sorted = [...reports].sort((a, b) => {
    if (sort === 'price') return b.result.predicted_price_sqm - a.result.predicted_price_sqm
    if (sort === 'growth') return b.result.growth_score - a.result.growth_score
    return b.createdAt.localeCompare(a.createdAt)
  })

  return (
    <div ref={pageRef} className="bg-canvas-alt">
      <div className="gutter mx-auto flex max-w-reading flex-col gap-lg py-xxl sm:py-section">
        <header data-reveal className="flex flex-col gap-md sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-xs">
            <h1 className="text-display-md sm:text-display-lg">Saved reports</h1>
            <p className="text-ink-secondary">
              {reports.length === 0
                ? 'Reports you save show up here.'
                : `${reports.length} ${reports.length === 1 ? 'location' : 'locations'}, stored on this device.`}
            </p>
          </div>
          {reports.length > 0 && (
            <ButtonLink to="/check" icon={<Plus size={20} aria-hidden />} className="self-start sm:self-auto">
              Check a location
            </ButtonLink>
          )}
        </header>

        {showDeleted && deleted && (
          <Banner tone="positive" title="Report deleted" onDismiss={() => setShowDeleted(false)}>
            {deleted} is no longer in your saved reports.
          </Banner>
        )}

        {reports.length === 0 ? (
          <div className="rounded-lg border border-hairline bg-surface">
            <EmptyState
              icon={Bookmark}
              title="No saved reports yet"
              body="Check a location, then tap Save report to keep it here and compare it with others."
              action={<ButtonLink to="/check">Check a location</ButtonLink>}
            />
          </div>
        ) : (
          <>
            {reports.length > 1 && (
              <div role="group" aria-label="Sort by" className="flex flex-wrap items-center gap-xs">
                <span className="mr-xxs text-caption text-ink-secondary" aria-hidden>
                  Sort by
                </span>
                {SORTS.map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    aria-pressed={sort === s.value}
                    onClick={() => setSort(s.value)}
                    className={`press min-h-tap rounded-pill border px-md text-caption ${
                      sort === s.value ? 'border-2 border-focus font-semibold' : 'border-hairline bg-surface'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
            <ul className="overflow-hidden rounded-lg border border-hairline bg-surface">
              {sorted.map((r, i) => {
                const grade = parseGrade(r.result.category)
                return (
                  <li key={r.id} data-reveal className={i > 0 ? 'border-t border-hairline' : ''}>
                    <Link
                      to={`/reports/${r.id}`}
                      className="press flex min-h-tap items-center gap-md p-md hover:bg-surface-raised active:scale-100 sm:px-lg"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-xs sm:flex-row sm:items-center sm:gap-lg">
                        <div className="flex min-w-0 flex-col gap-xxs sm:flex-1">
                          <p className="truncate font-semibold">{r.result.location}</p>
                          <p className="text-caption text-ink-secondary">{formatDate(r.createdAt)}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-sm">
                          <GradeBadge grade={grade} />
                          <p className="tabular-nums">
                            {formatPeso(r.result.predicted_price_sqm)}
                            <span className="text-caption text-ink-secondary"> / sqm</span>
                          </p>
                          <p className="text-caption tabular-nums text-ink-secondary">
                            Growth {Math.round(r.result.growth_score)}
                          </p>
                        </div>
                      </div>
                      <ChevronRight size={20} className="shrink-0 text-ink-secondary" aria-hidden />
                    </Link>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
