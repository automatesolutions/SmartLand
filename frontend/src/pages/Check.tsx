import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, LoaderCircle, RotateCcw } from 'lucide-react'
import { analyzeLocation, errorCopy, type AnalyzeInput } from '../lib/api'
import { DEFAULT_DATA, FACTORS, PLACE_SUGGESTIONS, PRESETS, type FactorKey } from '../lib/presets'
import { newReportId, storeDraft } from '../lib/reports'
import { Button } from '../components/Button'
import { RangeField, TextArea, TextField } from '../components/Fields'
import { Banner, Skeleton } from '../components/States'
import { useReveal } from '../lib/motion'

type Errors = Partial<Record<FactorKey | 'location', string>>

function validate(input: AnalyzeInput): Errors {
  const errors: Errors = {}
  if (input.location.trim().length < 2) errors.location = 'Enter a city, town, or barangay.'
  for (const f of FACTORS) {
    const v = input.data[f.key]
    if (Number.isNaN(v)) errors[f.key] = 'Enter a number.'
    else if (v < f.min || v > f.max) errors[f.key] = `Enter a number from ${f.min} to ${f.max}.`
  }
  return errors
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const id = useId()
  return (
    <section
      role="group"
      aria-labelledby={id}
      data-reveal
      className="flex flex-col gap-lg rounded-lg border border-hairline bg-surface p-md sm:p-lg"
    >
      <div className="flex flex-col gap-xxs">
        <h2 id={id} className="text-tagline font-semibold">
          {title}
        </h2>
        {hint && <p className="text-caption text-ink-secondary">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

export function CheckPage() {
  const navigate = useNavigate()
  const prefill = (useLocation().state as { input?: AnalyzeInput } | null)?.input
  const [location, setLocation] = useState(prefill?.location ?? '')
  const [data, setData] = useState<AnalyzeInput['data']>(prefill?.data ?? DEFAULT_DATA)
  const [preset, setPreset] = useState<string | null>(null)
  const [errors, setErrors] = useState<Errors>({})
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [failure, setFailure] = useState<unknown>(null)
  const abortRef = useRef<AbortController | null>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  useReveal(pageRef)

  useEffect(() => () => abortRef.current?.abort(), [])

  function setFactor(key: FactorKey, value: number) {
    setData((d) => ({ ...d, [key]: value }))
    setPreset(null)
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  function applyPreset(name: string) {
    const p = PRESETS.find((x) => x.name === name)
    if (!p) return
    setData((d) => ({ ...d, ...p.data }))
    setPreset(name)
    if (!location.trim() && name !== 'Rural lot') setLocation(name)
    setErrors({})
  }

  async function run() {
    const input: AnalyzeInput = { location: location.trim(), data }
    const found = validate(input)
    setErrors(found)
    const firstBad = Object.keys(found)[0]
    if (firstBad) {
      // Move focus to the first field that needs fixing
      const el = document.querySelector<HTMLElement>('[aria-invalid="true"]')
      el?.focus()
      return
    }
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('loading')
    setFailure(null)
    try {
      const result = await analyzeLocation(input, controller.signal)
      const id = newReportId()
      storeDraft({ id, createdAt: new Date().toISOString(), input, result })
      navigate(`/reports/${id}`, { state: { fresh: true } })
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setFailure(err)
      setStatus('error')
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void run()
  }

  const loading = status === 'loading'
  const copy = failure ? errorCopy(failure) : null

  return (
    <div ref={pageRef} className="bg-canvas-alt">
      <div className="gutter mx-auto flex max-w-form flex-col gap-xl py-xxl sm:py-section">
        <header data-reveal className="flex flex-col gap-sm">
          <h1 className="text-display-md sm:text-display-lg">Check a location</h1>
          <p className="text-ink-secondary">
            Enter what you know about the area. You'll get a price per sqm, a growth score, and an investment grade.
          </p>
        </header>

        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-lg" aria-busy={loading}>
          <Section title="Location">
            <TextField
              label="City, town, or barangay"
              name="location"
              placeholder="For example, Lipa, Batangas"
              autoComplete="address-level2"
              list="place-suggestions"
              value={location}
              onChange={(e) => {
                setLocation(e.target.value)
                if (errors.location) setErrors((x) => ({ ...x, location: undefined }))
              }}
              error={errors.location}
              required
            />
            <datalist id="place-suggestions">
              {PLACE_SUGGESTIONS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <div className="flex flex-col gap-xs">
              <p id="preset-label" className="font-semibold">
                Start from sample values
              </p>
              <p className="text-caption text-ink-secondary">
                Rough figures for a typical lot. Adjust them to match the land you're looking at.
              </p>
              <div role="group" aria-labelledby="preset-label" className="flex flex-wrap gap-xs pt-xxs">
                {PRESETS.map((p) => {
                  const selected = preset === p.name
                  return (
                    <button
                      key={p.name}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => applyPreset(p.name)}
                      className={`press min-h-tap rounded-pill border px-md text-caption ${
                        selected ? 'border-2 border-focus font-semibold text-ink' : 'border-hairline bg-surface text-ink'
                      }`}
                    >
                      {p.name}
                    </button>
                  )
                })}
              </div>
            </div>
          </Section>

          <Section title="The area" hint="These shape the growth score the most.">
            {FACTORS.filter((f) => f.group === 'area').map((f) => (
              <RangeField
                key={f.key}
                label={f.label}
                hint={f.hint}
                min={f.min}
                max={f.max}
                step={f.step}
                unit={f.unit}
                value={data[f.key]}
                onChange={(v) => setFactor(f.key, v)}
                error={errors[f.key]}
              />
            ))}
          </Section>

          <Section title="Getting around" hint="Closer amenities raise both price and growth.">
            {FACTORS.filter((f) => f.group === 'access').map((f) => (
              <RangeField
                key={f.key}
                label={f.label}
                hint={f.hint}
                min={f.min}
                max={f.max}
                step={f.step}
                unit={f.unit}
                value={data[f.key]}
                onChange={(v) => setFactor(f.key, v)}
                error={errors[f.key]}
              />
            ))}
          </Section>

          <Section title="Recent news" hint="Optional. New roads, malls, or airports nearby can lift the grade.">
            <TextArea
              label="News about this area"
              hint="Paste a headline or a short paragraph."
              placeholder="For example, DPWH starts work on a new bypass road through Lipa."
              value={data.news_text}
              maxLength={2000}
              onChange={(e) => setData((d) => ({ ...d, news_text: e.target.value }))}
            />
          </Section>

          {status === 'error' && copy && (
            <Banner
              tone="critical"
              title={copy.title}
              action={
                <Button variant="secondary" icon={<RotateCcw size={18} aria-hidden />} onClick={() => void run()}>
                  Try again
                </Button>
              }
            >
              {copy.body}
            </Banner>
          )}

          <div data-reveal className="flex flex-col gap-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-caption text-ink-secondary">Takes a few seconds. Nothing is saved until you choose to.</p>
            <Button
              type="submit"
              size="large"
              disabled={loading}
              className="w-full sm:w-auto"
              icon={loading ? <LoaderCircle size={20} className="animate-spin" aria-hidden /> : undefined}
              iconAfter={loading ? undefined : <ArrowRight size={20} aria-hidden />}
            >
              {loading ? 'Checking location' : 'Check this location'}
            </Button>
          </div>

          <p role="status" aria-live="polite" className="sr-only">
            {loading ? `Checking ${location.trim()}. This takes a few seconds.` : ''}
          </p>

          {loading && (
            <div aria-hidden className="flex flex-col gap-md rounded-lg border border-hairline bg-surface p-lg">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-12 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
