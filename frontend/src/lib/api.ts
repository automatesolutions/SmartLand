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
  /** Set when the coordinates came from a pin on the map */
  pinned?: boolean
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
  /** Missing on reports made before offices were mapped; the list order is the same */
  kind?: OfficeKind
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
  // FormData sets its own multipart content type
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json')
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
  if (res.status === 422 || res.status === 413 || res.status === 415) throw new ApiError('invalid', 'The server rejected the values', detail)
  // Vite's proxy answers 502/504 when the backend is not running
  if (res.status === 502 || res.status === 503 || res.status === 504) throw new ApiError('offline', `Backend unavailable (${res.status})`)
  if (!res.ok) throw new ApiError('server', `Backend error ${res.status}`, detail)
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function locate(query: string, signal?: AbortSignal): Promise<LocateResult> {
  return request<LocateResult>(`/api/locate?q=${encodeURIComponent(query)}`, {}, signal)
}

export type OfficeKind = 'assessor' | 'bir' | 'registry' | 'planning'

export interface OfficeLocation {
  name: string
  address?: string | null
  lat: number
  lon: number
}

/** Where the offices in a report's "Before you buy" list are. Null means not on the map. */
export function officeLocations(
  q: { town: string; province?: string | null; lat: number; lon: number },
  signal?: AbortSignal,
): Promise<Partial<Record<OfficeKind, OfficeLocation | null>>> {
  const params = new URLSearchParams({ town: q.town, lat: q.lat.toFixed(6), lon: q.lon.toFixed(6) })
  if (q.province) params.set('province', q.province)
  return request(`/api/offices?${params}`, {}, signal)
}

export type NearbyKind =
  | 'hospital'
  | 'school'
  | 'supermarket'
  | 'mall'
  | 'seven_eleven'
  | 'restaurant'
  | 'jollibee'
  | 'mcdonalds'
  | 'mang_inasal'
  | 'resort'
  | 'car_rental'
  | 'computer_shop'

export interface NearbyPlace {
  name: string | null
  address: string | null
  lat: number
  lon: number
  distance_km: number
  /** Which open dataset it came from */
  source?: 'openstreetmap' | 'overture'
}

/** How many of a kind are within `radius_km`, and the nearest few */
export interface NearbyCategory {
  count: number
  radius_km: number
  places: NearbyPlace[]
  /** Nearest mapped one within `search_km`, even outside `radius_km`. Missing on older answers. */
  nearest?: NearbyPlace | null
  search_km?: number
}

export interface NearbyResult {
  categories: Record<NearbyKind, NearbyCategory>
  /** True when OpenStreetMap wasn't back yet; asking again shortly gets the full list */
  partial: boolean
}

/** Schools, hospitals, shops, food, and more around a lot, from OpenStreetMap and Overture Maps */
export function nearbyPlaces(lat: number, lon: number, signal?: AbortSignal): Promise<NearbyResult> {
  return request(`/api/nearby?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`, {}, signal)
}

/** Same as locate, for a spot pinned on the map */
export function locatePoint(lat: number, lon: number, signal?: AbortSignal): Promise<LocateResult> {
  return request<LocateResult>(`/api/locate?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`, {}, signal)
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
  /** Can review the documents sellers upload */
  is_admin?: boolean
}

export function signInRequest(mode: 'login' | 'register', email: string, password: string, name?: string) {
  return request<{ token: string; user: User }>(`/api/auth/${mode}`, {
    method: 'POST',
    body: JSON.stringify({ email, password, name: name || undefined }),
  })
}

/** Which sign-in methods the server offers. google_client_id is null when Google sign-in isn't set up. */
export function authConfig() {
  return request<{ google_client_id: string | null }>('/api/auth/config')
}

/** Signs in with the ID token from Google's button or One Tap */
export function googleSignInRequest(credential: string) {
  return request<{ token: string; user: User }>('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential }) })
}

// Keys match listing_rules.CATEGORIES in the backend
export type ListingCategory =
  | 'farm_lot'
  | 'house_sale'
  | 'house_rent'
  | 'land_lease'
  | 'commercial_sale'
  | 'warehouse_lease'
  | 'beach'
  | 'foreclosure'

export type SellerType = 'owner' | 'broker' | 'developer' | 'bank'

export type DocumentType = 'title' | 'rights' | 'tax_declaration' | 'tax_clearance' | 'survey_plan' | 'other'

export type DetailValue = string | number | boolean

/** One input a kind of listing asks for */
export interface FieldSpec {
  key: string
  label: string
  type: 'number' | 'select' | 'bool' | 'text' | 'date'
  unit?: string
  options?: string[]
  required?: boolean
  min?: number
  max?: number
  hint?: string
}

export interface ListingSchema {
  categories: Record<ListingCategory, { label: string; rent: boolean; fields: FieldSpec[] }>
  documents: Record<DocumentType, { label: string; hint: string }>
  /** Credibility points per document: when uploaded, and once a reviewer checked it */
  scoring: Partial<Record<DocumentType, { label: string; uploaded: number; verified: number }>>
  max_document_mb: number
  document_types: string[]
}

export interface ListingInput {
  category: ListingCategory
  title: string
  description: string
  /** Whole pesos: the asking price, or the monthly rent for rentals and leases */
  price: number
  lot_sqm: number | null
  floor_sqm: number | null
  lat: number
  lon: number
  place: string
  town: string | null
  province: string | null
  seller_type: SellerType
  prc_license: string | null
  contact_name: string
  contact_phone: string
  details: Record<string, DetailValue>
  authorized: boolean
}

/** What anyone sees about a document. The file itself is private. */
export interface ListingDocument {
  id: string
  type: DocumentType
  status: 'pending' | 'verified' | 'rejected'
  /** SHA-256 of the file, for checking a copy */
  sha256: string
  size: number
  uploaded_at: string
  reviewed_at: string | null
  /** Only for the seller and reviewers */
  filename?: string
  mime?: string
  review_note?: string | null
}

export interface Credibility {
  score: number
  level: 'Low' | 'Fair' | 'Good' | 'Strong'
  items: { key: string; label: string; points: number; max: number; state: 'verified' | 'uploaded' | 'rejected' | 'missing' | 'complete' | 'partial' }[]
}

export interface Listing extends Omit<ListingInput, 'authorized' | 'contact_phone'> {
  id: string
  status: 'active' | 'sold'
  created_at: string
  updated_at: string
  mine: boolean
  documents: ListingDocument[]
  credibility: Credibility
  /** Only on a single listing, not in search results */
  contact_phone?: string
  /** Only in search results */
  distance_km?: number
}

export interface ListingSearch {
  radius_km: number
  count: number
  counts: Partial<Record<ListingCategory, number>>
  listings: Listing[]
}

/** One change to a listing, fingerprinted together with the one before it */
export interface ListingEvent {
  seq: number
  kind: 'listed' | 'price' | 'status' | 'document' | 'review'
  payload: Record<string, unknown>
  created_at: string
  prev_hash: string
  hash: string
}

export interface ReviewItem extends Required<Pick<ListingDocument, 'id' | 'type' | 'status' | 'sha256' | 'size' | 'uploaded_at' | 'filename' | 'mime'>> {
  listing_id: string
  listing_title: string
  listing_place: string
  listing_category: ListingCategory
  review_note: string | null
}

/** Fetches a private file with the signed-in token, as a blob the browser can open */
async function requestBlob(path: string): Promise<Blob> {
  const res = await fetch(path, { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} })
  if (res.status === 404 || res.status === 410) throw new ApiError('not-found', 'File not found')
  if (res.status === 401) throw new ApiError('unauthorized', 'Not signed in')
  if (!res.ok) throw new ApiError('server', `Backend error ${res.status}`)
  return res.blob()
}

const lid = (id: string) => `/api/listings/${encodeURIComponent(id)}`

export const listingsApi = {
  schema: () => request<ListingSchema>('/api/listings/schema'),
  near: (q: { lat: number; lon: number; radius_km: number; category?: ListingCategory }, signal?: AbortSignal) => {
    const params = new URLSearchParams({ lat: q.lat.toFixed(6), lon: q.lon.toFixed(6), radius_km: String(q.radius_km) })
    if (q.category) params.set('category', q.category)
    return request<ListingSearch>(`/api/listings?${params}`, {}, signal)
  },
  get: (id: string, signal?: AbortSignal) => request<Listing>(lid(id), {}, signal),
  record: (id: string, signal?: AbortSignal) => request<{ intact: boolean; events: ListingEvent[] }>(`${lid(id)}/record`, {}, signal),
  mine: () => request<Listing[]>('/api/listings/mine'),
  create: (input: ListingInput) => request<Listing>('/api/listings', { method: 'POST', body: JSON.stringify(input) }),
  setStatus: (id: string, status: 'active' | 'sold') => request<Listing>(lid(id), { method: 'PATCH', body: JSON.stringify({ status }) }),
  setPrice: (id: string, price: number) => request<Listing>(lid(id), { method: 'PATCH', body: JSON.stringify({ price }) }),
  remove: (id: string) => request<void>(lid(id), { method: 'DELETE' }),
  uploadDocument: (id: string, type: DocumentType, file: File) => {
    const form = new FormData()
    form.set('type', type)
    form.set('file', file)
    return request<ListingDocument>(`${lid(id)}/documents`, { method: 'POST', body: form })
  },
  documentFile: (listingId: string, docId: string) => requestBlob(`${lid(listingId)}/documents/${encodeURIComponent(docId)}/file`),
  /** Barangay, town, and province for a pinned spot, without the full lookup */
  reverse: (lat: number, lon: number, signal?: AbortSignal) =>
    request<Place>(`/api/reverse?lat=${lat.toFixed(6)}&lon=${lon.toFixed(6)}`, {}, signal),
}

export const reviewApi = {
  queue: (status: 'pending' | 'verified' | 'rejected') => request<ReviewItem[]>(`/api/admin/documents?status=${status}`),
  review: (docId: string, status: 'verified' | 'rejected', note: string) =>
    request<ListingDocument>(`/api/admin/documents/${encodeURIComponent(docId)}/review`, {
      method: 'POST',
      body: JSON.stringify({ status, note: note || null }),
    }),
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
