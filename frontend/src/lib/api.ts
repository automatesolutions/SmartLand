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

export type FactorSource = 'openstreetmap' | 'region' | 'estimate'

export interface Place {
  name: string
  display_name: string
  barangay?: string | null
  locality?: string | null
  province?: string | null
  region?: string | null
  lat: number
  lon: number
  kind?: 'center' | 'site'
  source: 'openstreetmap' | 'reference'
  elevation_m?: number | null
  elevation_source?: 'postgis' | 'open-meteo'
}

export interface Amenity {
  type: 'mall' | 'school' | 'hospital' | 'center'
  name: string | null
  lat: number
  lon: number
  distance_km: number
}

export interface Article {
  title: string
  source: string | null
  url: string | null
  published: string | null
}

export interface LocateResult {
  place: Place
  factors: Omit<AnalyzeInput['data'], 'news_text'>
  sources: Record<keyof Omit<AnalyzeInput['data'], 'news_text'>, FactorSource>
  amenities: Amenity[]
  news: { articles: Article[]; analysis: NewsAnalysis }
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

export interface Comp {
  name: string
  province: string
  lat: number
  lon: number
  distance_km: number
  price_low: number
  price_high: number
}

export interface Office {
  name: string
  purpose: string
}

export interface AnalyzeResult {
  location: string
  category: string
  predicted_price_sqm: number
  growth_score: number
  insights: string
  news_analysis?: NewsAnalysis | null
  feature_analysis?: FeatureAnalysis | null
  agency?: { name?: string; phone?: string; email?: string; address?: string } | null
  // Added with location lookup. Reports saved before then don't have these.
  price_low?: number
  price_high?: number
  confidence?: 'high' | 'medium' | 'low'
  comps?: Comp[]
  news_articles?: Article[]
  offices?: Office[]
  geo_data?: (Partial<Place> & { amenities?: Amenity[] }) | null
}

export type ApiErrorKind = 'offline' | 'server' | 'rate-limited' | 'invalid' | 'not-found' | 'unauthorized' | 'conflict'

export class ApiError extends Error {
  kind: ApiErrorKind
  detail?: string
  constructor(kind: ApiErrorKind, message: string, detail?: string) {
    super(message)
    this.kind = kind
    this.detail = detail
  }
}

let authToken: string | null = null
let onUnauthorized: (() => void) | null = null

/** Set by lib/auth.ts so every request carries the signed-in token */
export function configureAuth(token: string | null, unauthorized: () => void) {
  authToken = token
  onUnauthorized = unauthorized
}

async function request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body) headers.set('Content-Type', 'application/json')
  if (authToken) headers.set('Authorization', `Bearer ${authToken}`)

  let res: Response
  try {
    res = await fetch(path, { ...init, headers, signal })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError('offline', 'Network request failed')
  }

  let detail: string | undefined
  if (!res.ok) {
    try {
      const body = await res.json()
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // Not JSON, e.g. the Vite proxy's error page
    }
  }
  if (res.status === 401) {
    if (authToken) onUnauthorized?.()
    throw new ApiError('unauthorized', 'Not signed in', detail)
  }
  if (res.status === 404) throw new ApiError('not-found', 'Not found', detail)
  if (res.status === 409) throw new ApiError('conflict', 'Conflict', detail)
  if (res.status === 429) throw new ApiError('rate-limited', 'Too many requests')
  if (res.status === 422) throw new ApiError('invalid', 'The server rejected the values', detail)
  // Vite's proxy answers 502/504 when the backend is not running
  if (res.status === 502 || res.status === 503 || res.status === 504) throw new ApiError('offline', `Backend unavailable (${res.status})`)
  if (!res.ok) throw new ApiError('server', `Backend error ${res.status}`, detail)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function locate(query: string, signal?: AbortSignal): Promise<LocateResult> {
  return request<LocateResult>(`/api/locate?q=${encodeURIComponent(query)}`, {}, signal)
}

export interface AnalyzeContext {
  place?: Place
  amenities?: Amenity[]
  news_articles?: Article[]
  measured?: boolean
}

export async function analyzeLocation(input: AnalyzeInput, context: AnalyzeContext = {}, signal?: AbortSignal): Promise<AnalyzeResult> {
  const body = await request<AnalyzeResult>('/api/analyze', { method: 'POST', body: JSON.stringify({ ...input, ...context }) }, signal)
  if (typeof body.predicted_price_sqm !== 'number' || !body.category) {
    // The backend returns nulls when the AI service answered with something unexpected
    throw new ApiError('server', 'Incomplete report')
  }
  return body
}

export interface User {
  id: string
  email: string
  name: string | null
}

export function signInRequest(mode: 'login' | 'register', email: string, password: string, name?: string) {
  return request<{ token: string; user: User }>(`/api/auth/${mode}`, {
    method: 'POST',
    body: JSON.stringify({ email, password, name: name || undefined }),
  })
}

export const api = {
  me: () => request<User>('/api/auth/me'),
  listReports: <T>() => request<T[]>('/api/reports'),
  putReport: (report: { id: string }) => request<void>(`/api/reports/${report.id}`, { method: 'PUT', body: JSON.stringify(report) }),
  deleteReport: (id: string) => request<void>(`/api/reports/${id}`, { method: 'DELETE' }),
  shareReport: (id: string) => request<{ token: string }>(`/api/reports/${id}/share`, { method: 'POST' }),
  unshareReport: (id: string) => request<void>(`/api/reports/${id}/share`, { method: 'DELETE' }),
  sharedReport: <T>(token: string) => request<T>(`/api/shared/${encodeURIComponent(token)}`),
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
    case 'not-found':
      return {
        title: "We couldn't find this place",
        body: 'Check the spelling, or add the province, for example "Sabang, Lipa, Batangas".',
      }
    default:
      return {
        title: "We couldn't finish this report",
        body: 'The pricing service had a problem. Try again in a moment.',
      }
  }
}
