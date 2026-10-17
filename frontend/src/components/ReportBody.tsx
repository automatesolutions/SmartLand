import { useState, type ReactNode } from 'react'
import { Building2, CircleCheck, ExternalLink, Newspaper, TriangleAlert } from 'lucide-react'
import type { Report } from '../lib/reports'
import { GRADE_ORDER, formatPeso, gradeInfo, insightTone, parseGrade, splitInsights, toneText } from '../lib/format'
import { AMENITY_LABEL, FACTORS } from '../lib/presets'
import { GradeBadge, Meter } from './Grade'
import { MapView } from './Map'

const SENTIMENT_COPY = {
  positive: 'Mostly good news for the area.',
  negative: 'Mostly bad news for the area.',
  neutral: 'No clear signal either way.',
}

const CONFIDENCE_COPY = {
  high: 'Reference prices are close by and the area was measured from map data.',
  medium: 'Reference prices are within 25 km. Compare with local listings.',
  low: 'Few reference prices nearby. Treat this as a rough guide.',
}

export function Card({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section data-reveal className={`flex flex-col gap-lg rounded-lg border border-hairline bg-surface p-md sm:p-lg print:break-inside-avoid ${className}`}>
      <h2 className="text-tagline font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-tap items-center justify-between gap-md border-b border-hairline py-xs">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  )
}

export function ReportBody({ report }: { report: Report }) {
  const [lotSize, setLotSize] = useState(300)
  const { result, input } = report
  const grade = parseGrade(result.category)
  const insights = splitInsights(result.insights)
  const features = result.feature_analysis
  const news = result.news_analysis
  const newsInsights = Array.isArray(news?.insights) ? news.insights : []
  const articles = result.news_articles ?? []
  const geo = result.geo_data
  const hasPoint = typeof geo?.lat === 'number' && typeof geo?.lon === 'number'
  const comps = result.comps ?? []
  const total = Number.isFinite(lotSize) && lotSize > 0 ? result.predicted_price_sqm * lotSize : null
  const hasRange = typeof result.price_low === 'number' && typeof result.price_high === 'number'

  return (
    <div className="gutter mx-auto flex max-w-reading flex-col gap-lg py-xxl sm:py-section">
      {/* Headline numbers */}
      <div className="grid gap-lg md:grid-cols-2">
        <Card title="Estimated price">
          <div className="flex flex-col gap-xxs">
            <p className="text-display-lg tabular-nums sm:text-hero">{formatPeso(result.predicted_price_sqm)}</p>
            <p className="text-ink-secondary">per square meter</p>
          </div>
          {hasRange && (
            <div className="flex flex-col gap-xxs">
              <p className="tabular-nums">
                Likely between <span className="font-semibold">{formatPeso(result.price_low!)}</span> and{' '}
                <span className="font-semibold">{formatPeso(result.price_high!)}</span>
              </p>
              {result.confidence && (
                <p className="text-caption text-ink-secondary">
                  <span className="font-semibold text-ink">
                    {result.confidence[0].toUpperCase() + result.confidence.slice(1)} confidence.
                  </span>{' '}
                  {CONFIDENCE_COPY[result.confidence]}
                </p>
              )}
            </div>
          )}
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
          <Meter label="Growth score" value={result.growth_score} max={100} hint="How strongly local conditions point to rising prices." />
          <div className="flex flex-col gap-xs border-t border-hairline pt-md">
            <p className="font-semibold">
              {grade.grade} · {grade.label}
            </p>
            <p className="text-ink-secondary">{grade.summary}</p>
          </div>
        </Card>
      </div>

      {hasPoint && (
        <Card title="Where it is">
          <MapView lat={geo!.lat!} lon={geo!.lon!} label={geo!.name ?? result.location} amenities={geo!.amenities} comps={comps} />
          <dl className="grid gap-x-lg sm:grid-cols-2">
            {geo!.display_name && (
              <div className="sm:col-span-2">
                <Row label="Found as">
                  <span className="block max-w-80 truncate sm:max-w-none" title={geo!.display_name}>
                    {geo!.display_name}
                  </span>
                </Row>
              </div>
            )}
            <Row label="Coordinates">
              {geo!.lat!.toFixed(5)}, {geo!.lon!.toFixed(5)}
            </Row>
            {geo!.elevation_m != null && (
              <Row label="Elevation">
                {Math.round(geo!.elevation_m)} m{geo!.elevation_source === 'postgis' ? ' (30 m terrain model)' : ''}
              </Row>
            )}
            {(geo!.amenities ?? []).map((a) => (
              <Row key={a.type} label={`Nearest ${AMENITY_LABEL[a.type].toLowerCase()}`}>
                {a.distance_km.toFixed(1)} km{a.name ? ` · ${a.name}` : ''}
              </Row>
            ))}
          </dl>
          <p className="text-caption text-ink-secondary">Distances are straight-line. Road distance is usually longer.</p>
        </Card>
      )}

      {comps.length > 0 && (
        <Card title="Nearby reference prices">
          <p className="text-caption text-ink-secondary">
            The estimate starts from these areas, weighted by how close they are. They are typical asking prices, not
            official zonal values.
          </p>
          <div className="-mx-md overflow-x-auto sm:mx-0">
            <table className="w-full min-w-120 border-collapse text-left">
              <thead>
                <tr className="border-b border-hairline text-caption text-ink-secondary">
                  <th scope="col" className="px-md py-xs font-regular sm:px-0">Area</th>
                  <th scope="col" className="px-md py-xs text-right font-regular">Distance</th>
                  <th scope="col" className="px-md py-xs text-right font-regular sm:pr-0">Price per sqm</th>
                </tr>
              </thead>
              <tbody>
                {comps.map((c) => (
                  <tr key={`${c.name}-${c.province}`} className="border-b border-hairline">
                    <th scope="row" className="px-md py-sm font-regular sm:px-0">
                      {c.name}
                      <span className="text-caption text-ink-secondary">, {c.province}</span>
                    </th>
                    <td className="px-md py-sm text-right tabular-nums">{c.distance_km} km</td>
                    <td className="px-md py-sm text-right tabular-nums sm:pr-0">
                      {formatPeso(c.price_low)} to {formatPeso(c.price_high)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

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
            <Meter label="Economy" value={Math.min(10, features.economic_score)} max={10} hint="Regional GDP and population growth." />
            <Meter label="Risk" value={Math.min(10, features.risk_score)} max={10} invert hint="Typhoon and flood exposure, and weak infrastructure. Lower is better." />
          </div>
        </Card>
      )}

      {news && (input.data.news_text.trim() || articles.length > 0) && (
        <Card title="News check">
          <div className="flex items-start gap-sm">
            <Newspaper size={22} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink-secondary" aria-hidden />
            <div className="flex min-w-0 flex-col gap-sm">
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
              {input.data.news_text.trim() ? (
                <blockquote className="border-l-2 border-hairline pl-sm text-caption text-ink-secondary">{input.data.news_text}</blockquote>
              ) : (
                <ul className="flex flex-col gap-xs">
                  {articles.map((a) => (
                    <li key={a.title} className="text-caption">
                      {a.url ? (
                        <a href={a.url} target="_blank" rel="noreferrer" className="inline-flex min-h-tap items-center gap-xxs text-accent">
                          <span>{a.title}</span>
                          <ExternalLink size={14} className="shrink-0" aria-hidden />
                          <span className="sr-only">(opens in a new tab)</span>
                        </a>
                      ) : (
                        a.title
                      )}
                      <span className="block text-ink-secondary">
                        {[a.source, a.published].filter(Boolean).join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}

      <Card title="Values used">
        <dl className="grid gap-x-lg sm:grid-cols-2">
          {FACTORS.map((f) => (
            <Row key={f.key} label={f.label}>
              {input.data[f.key]}
              {f.unit ? ` ${f.unit}` : ' of 10'}
            </Row>
          ))}
        </dl>
      </Card>

      {((result.offices?.length ?? 0) > 0 || result.agency?.name) && (
        <Card title="Before you buy">
          <p className="text-ink-secondary">Check the lot with these offices. They hold the official records.</p>
          <ul className="flex flex-col gap-sm">
            {result.agency?.name && (
              <li className="flex items-start gap-sm">
                <Building2 size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                <span>
                  <span className="block font-semibold">{result.agency.name}</span>
                  <span className="block text-caption text-ink-secondary">
                    {[result.agency.address, result.agency.phone, result.agency.email].filter(Boolean).join(' · ') || 'Local contact'}
                  </span>
                </span>
              </li>
            )}
            {result.offices?.map((o) => (
              <li key={o.name} className="flex items-start gap-sm">
                <Building2 size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-ink-secondary" aria-hidden />
                <span>
                  <span className="block font-semibold">{o.name}</span>
                  <span className="block text-caption text-ink-secondary">{o.purpose}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="How grades work" className="print:hidden">
        <ol className="flex flex-col gap-sm">
          {GRADE_ORDER.map((g) => {
            const info = gradeInfo(g)
            const current = info.grade === grade.grade
            return (
              <li
                key={g}
                aria-current={current ? 'true' : undefined}
                className={`flex flex-col gap-xs rounded-lg p-sm sm:flex-row sm:items-center sm:gap-md ${current ? 'bg-surface-raised ring-2 ring-focus' : ''}`}
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
    </div>
  )
}
