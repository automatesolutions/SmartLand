import { useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowRight,
  BookmarkCheck,
  BookmarkPlus,
  ChevronLeft,
  CircleCheck,
  FileQuestion,
  Newspaper,
  Pencil,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { deleteReport, findReport, saveReport, useSavedReports } from '../lib/reports'
import { formatDate, formatPeso, GRADE_ORDER, gradeInfo, insightTone, parseGrade, splitInsights, toneText } from '../lib/format'
import { FACTORS } from '../lib/presets'
import { useReveal } from '../lib/motion'
import { Button, ButtonLink } from '../components/Button'
import { GradeBadge, Meter } from '../components/Grade'
import { Banner, EmptyState } from '../components/States'

const SENTIMENT_COPY = {
  positive: 'Mostly good news for the area.',
  negative: 'Mostly bad news for the area.',
  neutral: 'No clear signal either way.',
}

function Card({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section data-reveal className={`flex flex-col gap-lg rounded-lg border border-hairline bg-surface p-md sm:p-lg ${className}`}>
      <h2 className="text-tagline font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export function ReportPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const fresh = (useLocation().state as { fresh?: boolean } | null)?.fresh ?? false
  // Subscribing re-renders this page when the saved list changes, so the
  // lookup below always reflects whether the report is saved
  useSavedReports()
  const found = findReport(id)
  const [notice, setNotice] = useState<'saved' | 'save-failed' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [lotSize, setLotSize] = useState(300)
  const pageRef = useRef<HTMLDivElement>(null)
  useReveal(pageRef, [id])

  if (!found) {
    return (
      <EmptyState
        as="h1"
        icon={FileQuestion}
        title="We can't find this report"
        body="It may have been deleted, or it was made in a different browser. Reports are stored on this device."
        action={<ButtonLink to="/check">Check a location</ButtonLink>}
      />
    )
  }

  const { report, saved } = found
  const { result, input } = report
  const grade = parseGrade(result.category)
  const insights = splitInsights(result.insights)
  const features = result.feature_analysis
  const news = result.news_analysis
  const newsInsights = Array.isArray(news?.insights) ? news.insights : []
  const total = Number.isFinite(lotSize) && lotSize > 0 ? result.predicted_price_sqm * lotSize : null

  function onSave() {
    setNotice(saveReport(report) ? 'saved' : 'save-failed')
  }

  function onDelete() {
    deleteReport(report.id)
    navigate('/reports', { state: { deleted: result.location } })
  }

  return (
    <div ref={pageRef}>
      {/* Header band */}
      <div className="bg-canvas-alt">
        <div className="gutter mx-auto flex max-w-reading flex-col gap-lg pb-xxl pt-lg sm:pb-section">
          <Link
            to={saved ? '/reports' : '/check'}
            state={saved ? undefined : { input }}
            className="press -ml-xs inline-flex min-h-tap items-center gap-xxs self-start px-xs text-accent"
          >
            <ChevronLeft size={20} aria-hidden />
            {saved ? 'Saved reports' : 'Back to the form'}
          </Link>

          <div data-reveal className="flex flex-col gap-sm">
            <p className="text-caption text-ink-secondary">
              Report · {formatDate(report.createdAt)}
            </p>
            <h1 className="text-display-md sm:text-display-lg">{result.location}</h1>
            <div>
              <GradeBadge grade={grade} size="large" />
            </div>
          </div>

          {notice === 'saved' && (
            <Banner
              tone="positive"
              title="Report saved"
              onDismiss={() => setNotice(null)}
              action={
                <ButtonLink to="/reports" variant="plain" className="-ml-xs" iconAfter={<ArrowRight size={18} aria-hidden />}>
                  Open saved reports
                </ButtonLink>
              }
            >
              It stays on this device until you delete it.
            </Banner>
          )}
          {notice === 'save-failed' && (
            <Banner tone="critical" title="We couldn't save this report" onDismiss={() => setNotice(null)}>
              Your browser is blocking site storage. Allow storage for this site, then try again.
            </Banner>
          )}
          {fresh && !saved && notice === null && (
            <p role="status" className="sr-only">
              Report ready for {result.location}.
            </p>
          )}

          <div data-reveal className="flex flex-col gap-sm xs:flex-row xs:flex-wrap">
            {saved ? (
              <Button variant="secondary" icon={<BookmarkCheck size={20} aria-hidden />} disabled>
                Saved
              </Button>
            ) : (
              <Button onClick={onSave} icon={<BookmarkPlus size={20} aria-hidden />}>
                Save report
              </Button>
            )}
            <ButtonLink to="/check" state={{ input }} variant="secondary" icon={<Pencil size={18} aria-hidden />}>
              Change values
            </ButtonLink>
          </div>
        </div>
      </div>

      <div className="gutter mx-auto flex max-w-reading flex-col gap-lg py-xxl sm:py-section">
        {/* Headline numbers */}
        <div className="grid gap-lg md:grid-cols-2">
          <Card title="Estimated price">
            <div className="flex flex-col gap-xxs">
              <p className="text-display-lg tabular-nums sm:text-hero">{formatPeso(result.predicted_price_sqm)}</p>
              <p className="text-ink-secondary">per square meter</p>
            </div>
            <div className="flex flex-col gap-xs border-t border-hairline pt-md">
              <label htmlFor="lot-size" className="font-semibold">
                Lot size
              </label>
              <div className="flex items-center gap-xs">
                <input
                  id="lot-size"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={Number.isNaN(lotSize) ? '' : lotSize}
                  onChange={(e) => setLotSize(e.target.value === '' ? NaN : Number(e.target.value))}
                  className="h-tap w-32 rounded-sm border border-hairline bg-surface px-sm text-right tabular-nums text-ink focus-visible:border-focus"
                />
                <span className="text-ink-secondary">sqm</span>
              </div>
              <p className="tabular-nums" aria-live="polite">
                {total !== null ? (
                  <>
                    About <span className="font-semibold">{formatPeso(total)}</span> for the whole lot
                  </>
                ) : (
                  <span className="text-ink-secondary">Enter a lot size to see the total.</span>
                )}
              </p>
            </div>
          </Card>

          <Card title="Growth outlook">
            <Meter
              label="Growth score"
              value={result.growth_score}
              max={100}
              hint="How strongly local conditions point to rising prices."
            />
            <div className="flex flex-col gap-xs border-t border-hairline pt-md">
              <p className="font-semibold">
                {grade.grade} · {grade.label}
              </p>
              <p className="text-ink-secondary">{grade.summary}</p>
            </div>
          </Card>
        </div>

        {insights.length > 0 && (
          <Card title="What drives this result">
            <ul className="flex flex-col gap-sm">
              {insights.map((text) => {
                const tone = insightTone(text)
                const Icon = tone === 'caution' ? TriangleAlert : CircleCheck
                return (
                  <li key={text} className="flex items-start gap-sm">
                    <Icon size={20} strokeWidth={2} className={`mt-0.5 shrink-0 ${toneText[tone]}`} aria-hidden />
                    <span>
                      <span className="sr-only">{tone === 'caution' ? 'Watch out: ' : 'Good sign: '}</span>
                      {text}
                    </span>
                  </li>
                )
              })}
            </ul>
          </Card>
        )}

        {features && (
          <Card title="Area scores">
            <div className="grid gap-lg md:grid-cols-3">
              <Meter label="Amenities" value={Math.min(10, features.amenity_score)} max={10} hint="Closeness to malls, schools, and hospitals." />
              <Meter label="Economy" value={Math.min(10, features.economic_score)} max={10} hint="Local GDP and population growth." />
              <Meter label="Risk" value={Math.min(10, features.risk_score)} max={10} invert hint="Typhoon exposure and weak infrastructure. Lower is better." />
            </div>
          </Card>
        )}

        {input.data.news_text.trim() && news && (
          <Card title="News check">
            <div className="flex items-start gap-sm">
              <Newspaper size={22} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink-secondary" aria-hidden />
              <div className="flex flex-col gap-xs">
                <p>
                  <span className="font-semibold capitalize">{news.sentiment}</span>. {SENTIMENT_COPY[news.sentiment]}
                </p>
                {newsInsights.length > 0 && (
                  <ul className="flex list-disc flex-col gap-xxs pl-lg text-ink-secondary">
                    {newsInsights.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                )}
                <blockquote className="border-l-2 border-hairline pl-sm text-caption text-ink-secondary">
                  {input.data.news_text}
                </blockquote>
              </div>
            </div>
          </Card>
        )}

        <Card title="Values used">
          <dl className="grid gap-x-lg sm:grid-cols-2">
            {FACTORS.map((f) => (
              <div key={f.key} className="flex min-h-tap items-center justify-between gap-md border-b border-hairline py-xs">
                <dt className="text-ink-secondary">{f.label}</dt>
                <dd className="tabular-nums">
                  {input.data[f.key]}
                  {f.unit ? ` ${f.unit}` : ' of 10'}
                </dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="How grades work">
          <ol className="flex flex-col gap-sm">
            {GRADE_ORDER.map((g) => {
              const info = gradeInfo(g)
              const current = info.grade === grade.grade
              return (
                <li
                  key={g}
                  aria-current={current ? 'true' : undefined}
                  className={`flex flex-col gap-xs rounded-md p-sm sm:flex-row sm:items-center sm:gap-md ${current ? 'bg-surface-raised ring-2 ring-focus' : ''}`}
                >
                  <div className="sm:w-56 sm:shrink-0">
                    <GradeBadge grade={info} />
                  </div>
                  <p className="text-caption text-ink-secondary">
                    {current && <span className="font-semibold text-ink">This location. </span>}
                    {info.summary}
                  </p>
                </li>
              )
            })}
          </ol>
        </Card>

        <div data-reveal className="flex flex-col gap-md border-t border-hairline pt-lg sm:flex-row sm:items-center sm:justify-between">
          <ButtonLink to="/check" variant="plain" iconAfter={<ArrowRight size={18} aria-hidden />} className="self-start">
            Check another location
          </ButtonLink>
          {saved &&
            (confirmDelete ? (
              <div role="group" aria-label="Confirm delete" className="flex flex-wrap items-center gap-sm">
                <span className="text-caption">Delete this report?</span>
                <Button variant="plain" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
                <Button variant="secondary" className="border-critical text-critical" onClick={onDelete}>
                  Delete
                </Button>
              </div>
            ) : (
              <Button
                variant="plain"
                className="self-start text-critical"
                icon={<Trash2 size={18} aria-hidden />}
                onClick={() => setConfirmDelete(true)}
              >
                Delete report
              </Button>
            ))}
        </div>
      </div>
    </div>
  )
}
