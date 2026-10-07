// Client for the SmartLand backend (backend/main.py). Vite proxies /api to it.

export interface AnalyzeInput {
  location: string
  data: {
    distance_to_amenities: number
    population_growth: number
    gdp_growth: number
    infrastructure_score: number
    typhoon_risk: number
    proximity_to_mall: number
    proximity_to_school: number
    proximity_to_hospital: number
    news_text: string
  }
}

export interface FeatureAnalysis {
  amenity_score: number
  economic_score: number
  risk_score: number
  [key: string]: number
}

export interface NewsAnalysis {
  sentiment: 'positive' | 'negative' | 'neutral'
  entities: { text: string; type: string }[]
  insights: string[] | string
}

export interface AnalyzeResult {
  location: string
  category: string
  predicted_price_sqm: number
  growth_score: number
  insights: string
  news_analysis?: NewsAnalysis | null
  feature_analysis?: FeatureAnalysis | null
  agency?: { name?: string } | null
}

export type ApiErrorKind = 'offline' | 'server' | 'rate-limited' | 'invalid'

export class ApiError extends Error {
  kind: ApiErrorKind
  constructor(kind: ApiErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}

// The app has no sign-in yet, so it uses the backend's open test endpoint.
// Swap to /api/analyze with a Bearer token once accounts exist.
const ANALYZE_URL = '/api/test-analyze'

export async function analyzeLocation(input: AnalyzeInput, signal?: AbortSignal): Promise<AnalyzeResult> {
  let res: Response
  try {
    res = await fetch(ANALYZE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError('offline', 'Network request failed')
  }

  if (res.status === 429) throw new ApiError('rate-limited', 'Too many requests')
  if (res.status === 422) throw new ApiError('invalid', 'The server rejected the values')
  // Vite's proxy answers 502/504 when the backend is not running
  if (res.status === 502 || res.status === 503 || res.status === 504) throw new ApiError('offline', `Backend unavailable (${res.status})`)
  if (!res.ok) throw new ApiError('server', `Backend error ${res.status}`)

  const body = (await res.json()) as AnalyzeResult
  if (typeof body.predicted_price_sqm !== 'number' || !body.category) {
    // The backend returns nulls when the AI service answered with something unexpected
    throw new ApiError('server', 'Incomplete report')
  }
  return body
}

export function errorCopy(err: unknown): { title: string; body: string } {
  const kind = err instanceof ApiError ? err.kind : 'server'
  switch (kind) {
    case 'offline':
      return {
        title: "We couldn't reach SmartLand",
        body: 'The pricing service is not answering. Check that the backend and AI service are running, then try again.',
      }
    case 'rate-limited':
      return {
        title: 'Too many checks in a short time',
        body: 'Wait a few minutes, then try again.',
      }
    case 'invalid':
      return {
        title: "Some values weren't accepted",
        body: 'Check the numbers in the form, then try again.',
      }
    default:
      return {
        title: "We couldn't finish this report",
        body: 'The pricing service had a problem. Try again in a moment.',
      }
  }
}
