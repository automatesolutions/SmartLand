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

export type ApiErrorKind = 'offline' | 'slow' | 'server' | 'rate-limited' | 'invalid' | 'not-found' | 'unauthorized' | 'forbidden' | 'conflict'

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
  if (res.status === 403) throw new ApiError('forbidden', 'Not allowed', detail)
  if (res.status === 404) throw new ApiError('not-found', 'Not found', detail)
  if (res.status === 409) throw new ApiError('conflict', 'Conflict', detail)
  if (res.status === 429) throw new ApiError('rate-limited', 'Too many requests')
  if (res.status === 422 || res.status === 413 || res.status === 415) throw new ApiError('invalid', 'The server rejected the values', detail)
  // The backend answers 504 with a reason when the map service runs slow
  if (res.status === 504 && detail) throw new ApiError('slow', 'Map service slow', detail)
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
): Promise<Partial<Record<OfficeKind, OfficeLocation | null>> & { partial?: boolean }> {
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

/** Finds a town or barangay by name, without the map survey and news that locate runs */
export function geocode(query: string, signal?: AbortSignal): Promise<Place> {
  return request<Place>(`/api/geocode?q=${encodeURIComponent(query)}`, {}, signal)
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
  /** Google sign-ins are verified. Password accounts aren't confirmed yet. */
  email_verified?: boolean
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
  max_photo_mb: number
  max_photos: number
  photo_types: string[]
  /** Walkthrough videos. Off until video storage is set up on the server. */
  video: { enabled: boolean; max_mb: number; max_seconds: number; max_per_listing: number; types: string[] }
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
  /** Sale listings: the title comes with the listing, or the seller confirmed they have none to show */
  title_status?: 'attached' | 'none' | null
  /** Post for a business account you're on. Null posts as yourself. */
  org_id?: string | null
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

/** Where the title stands: checked by a reviewer, shown but not checked yet, failed review, or not shown */
export type TitleState = 'checked' | 'shown' | 'rejected' | 'none'

/** A public photo of the property */
export interface ListingPhoto {
  id: string
  alt: string
  url: string
}

/** A walkthrough video. The link expires after an hour, so reload the listing for a fresh one. */
export interface ListingVideo {
  id: string
  url: string
  mime: string
  size: number
  duration_s: number | null
  created_at: string
}

export interface Listing extends Omit<ListingInput, 'authorized' | 'contact_phone'> {
  id: string
  /** The business account it was posted for */
  org: ListingOrg | null
  title_state: TitleState
  photos: ListingPhoto[]
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
  /** Only on a single listing */
  videos?: ListingVideo[]
  /** The seller's team, and SmartLand reviewers */
  can_remove_videos?: boolean
  /** Only for the seller's team */
  video_space_left_mb?: number
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

/**
 * Uploads a form with the signed-in token and reports progress from 0 to 1.
 * fetch can't report upload progress, so this uses XMLHttpRequest.
 */
function upload<T>(path: string, form: FormData, onProgress?: (fraction: number) => void): Promise<T> {
  return send<T>('POST', path, form, { auth: true }, onProgress)
}

function send<T>(
  method: string,
  url: string,
  body: XMLHttpRequestBodyInit,
  opts: { auth: boolean; headers?: Record<string, string> },
  onProgress?: (fraction: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    if (opts.auth && authToken) xhr.setRequestHeader('Authorization', `Bearer ${authToken}`)
    for (const [k, v] of Object.entries(opts.headers ?? {})) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total)
    xhr.onerror = () => reject(new ApiError('offline', 'Network request failed'))
    xhr.onload = () => {
      let body: { detail?: unknown } | null = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        // Not JSON
      }
      const detail = typeof body?.detail === 'string' ? body.detail : undefined
      const st = xhr.status
      if (st >= 200 && st < 300) return resolve(body as T)
      if (st === 401) {
        if (opts.auth && authToken) onUnauthorized?.()
        return reject(new ApiError('unauthorized', 'Not signed in', detail))
      }
      if (st === 403) return reject(new ApiError('forbidden', 'Not allowed', detail))
      if (st === 404) return reject(new ApiError('not-found', 'Not found', detail))
      if (st === 429) return reject(new ApiError('rate-limited', 'Too many requests'))
      if (st === 413 || st === 415 || st === 422) return reject(new ApiError('invalid', 'The server rejected the file', detail))
      if (st === 502 || st === 503 || st === 504) return reject(new ApiError('offline', `Unavailable (${st})`))
      reject(new ApiError('server', `Error ${st}`, detail))
    }
    xhr.send(body)
  })
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
  uploadDocument: (id: string, type: DocumentType, file: File, onProgress?: (fraction: number) => void) => {
    const form = new FormData()
    form.set('type', type)
    form.set('file', file)
    return upload<ListingDocument>(`${lid(id)}/documents`, form, onProgress)
  },
  uploadPhoto: (id: string, file: File, alt: string, onProgress?: (fraction: number) => void) => {
    const form = new FormData()
    form.set('alt', alt)
    form.set('file', file)
    return upload<ListingPhoto>(`${lid(id)}/photos`, form, onProgress)
  },
  /** Counts a visit. Visits by the listing's own team aren't counted. */
  visit: (id: string, ref: Ref) => request<void>(`${lid(id)}/visits`, { method: 'POST', body: JSON.stringify(ref) }),
  /** A buyer's message to the seller. Signed-in buyers get a thread id to read replies. */
  inquire: (id: string, input: InquiryInput) =>
    request<{ sent: true; thread_id: string | null; seller: string }>(`${lid(id)}/inquiries`, { method: 'POST', body: JSON.stringify(input) }),
  deletePhoto: (id: string, photoId: string) => request<void>(`${lid(id)}/photos/${encodeURIComponent(photoId)}`, { method: 'DELETE' }),
  /**
   * Adds a video in three steps: the server checks the caps and gives an upload
   * link, the file goes straight to storage, then the server checks the file.
   */
  uploadVideo: async (id: string, file: Blob, durationS: number | null, onProgress?: (fraction: number) => void) => {
    const mime = file.type.split(';')[0]
    const start = await request<{ id: string; upload: { method: string; url: string; headers: Record<string, string> } }>(`${lid(id)}/videos`, {
      method: 'POST',
      body: JSON.stringify({ mime, size: file.size, duration_s: durationS }),
    })
    // The storage link carries its own signature: no sign-in token goes to it
    await send<void>(start.upload.method, start.upload.url, file, { auth: false, headers: start.upload.headers }, onProgress)
    return request<ListingVideo>(`${lid(id)}/videos/${encodeURIComponent(start.id)}/complete`, { method: 'POST' })
  },
  deleteVideo: (id: string, videoId: string) => request<void>(`${lid(id)}/videos/${encodeURIComponent(videoId)}`, { method: 'DELETE' }),
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

// Business accounts (backend/business.py) -----------------------------------------------

export type OrgKind = 'brokerage' | 'developer' | 'agency' | 'other'
export type OrgRole = 'owner' | 'admin' | 'member' | 'guest'
export type InviteRole = Exclude<OrgRole, 'owner'>

export interface Org {
  id: string
  name: string
  /** `personal` is a seller's own CRM, with no team */
  kind: OrgKind | 'personal'
  prc_license: string | null
  created_at: string
  role: OrgRole
  /** Only in the list of your orgs */
  members?: number
}

export type ListingOrg = Pick<Org, 'id' | 'name' | 'prc_license'> & { kind: OrgKind }

export interface Member {
  id: string
  email: string
  name: string | null
  role: OrgRole
  joined_at: string
}

export interface Invite {
  id: string
  email: string
  role: InviteRole
  created_at: string
  expires_at: string
}

export interface InvitePreview {
  email: string
  role: InviteRole
  expires_at: string
  org_name: string
  inviter: string
}

const oid = (id: string) => `/api/business/orgs/${encodeURIComponent(id)}`

export const businessApi = {
  mine: () => request<Org[]>('/api/business/orgs/mine'),
  get: (id: string, signal?: AbortSignal) => request<Org>(oid(id), {}, signal),
  create: (input: { name: string; kind: OrgKind; prc_license: string | null }) =>
    request<Org>('/api/business/orgs', { method: 'POST', body: JSON.stringify(input) }),
  members: (id: string, signal?: AbortSignal) => request<{ members: Member[]; invites: Invite[] }>(`${oid(id)}/members`, {}, signal),
  /** The token comes back this once. Share `path` with the person you invite. */
  invite: (id: string, email: string, role: InviteRole) =>
    request<Invite & { token: string; path: string }>(`${oid(id)}/invites`, { method: 'POST', body: JSON.stringify({ email, role }) }),
  cancelInvite: (id: string, inviteId: string) => request<void>(`${oid(id)}/invites/${encodeURIComponent(inviteId)}`, { method: 'DELETE' }),
  setRole: (id: string, userId: string, role: InviteRole) =>
    request<{ user_id: string; role: InviteRole }>(`${oid(id)}/members/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  removeMember: (id: string, userId: string) => request<void>(`${oid(id)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  invitePreview: (token: string, signal?: AbortSignal) => request<InvitePreview>(`/api/invites/${encodeURIComponent(token)}`, {}, signal),
  acceptInvite: (token: string) => request<{ org_id: string }>(`/api/invites/${encodeURIComponent(token)}/accept`, { method: 'POST' }),
  /** Your own CRM for leads on your solo listings, made the first time you open it */
  personal: () => request<Org>('/api/business/personal', { method: 'POST' }),
}

// CRM (backend/crm.py) -------------------------------------------------------------------

export interface InquiryInput {
  name: string
  phone: string | null
  email: string | null
  message: string
  consent: boolean
  /** Hidden field that only bots fill in */
  website: string
  /** Where the buyer came from (lib/utm.ts) */
  ref?: Ref | null
}

/** Where a visitor came from: UTM tags, or a source worked out from the referrer */
export interface Ref {
  source: string
  medium: string
  campaign: string
}

export interface Stage {
  id: string
  name: string
  position: number
  outcome: 'won' | 'lost' | null
}

export interface LeadSummary {
  id: string
  org_id: string
  contact_name: string
  stage_id: string
  stage: string
  listing: { id: string; title: string; status: string } | null
  assignee: { id: string; name: string } | null
  source: 'inquiry' | 'manual'
  /** Where an inquiry's buyer came from; null for direct visits and manual leads */
  ref: { source: string; medium: string | null; campaign: string | null } | null
  /** YYYY-MM-DD */
  follow_up_on: string | null
  /** Buyer messages the team hasn't read */
  unread: number
  created_at: string
  updated_at: string
  closed_at: string | null
  last_message_at: string | null
}

export type Activity =
  | { id: string; kind: 'created'; body: { source: 'inquiry' | 'manual' }; actor: string | null; created_at: string }
  | { id: string; kind: 'inquiry'; body: Record<string, never>; actor: null; created_at: string }
  | { id: string; kind: 'note'; body: { text: string }; actor: string | null; created_at: string }
  | { id: string; kind: 'stage'; body: { from: string | null; to: string }; actor: string | null; created_at: string }
  | { id: string; kind: 'assigned'; body: { to: string | null }; actor: string | null; created_at: string }
  | { id: string; kind: 'follow_up'; body: { on: string | null }; actor: string | null; created_at: string }

export interface Message {
  id: string
  sender: 'buyer' | 'team'
  /** Who on the team wrote it. Null for the buyer. */
  author: string | null
  body: string
  created_at: string
}

export interface Lead extends LeadSummary {
  contact: {
    id: string
    name: string
    phone: string | null
    email: string | null
    /** The buyer asked while signed in, so they can read replies in SmartLand */
    has_account: boolean
    consent_at: string | null
    consent_version: string | null
  }
  message: string | null
  activities: Activity[]
  messages: Message[]
}

export interface CrmMember {
  id: string
  name: string
  role: OrgRole
}

export interface Crm {
  stages: Stage[]
  leads: LeadSummary[]
  members: CrmMember[]
  role: OrgRole
}

export interface NewLeadInput {
  name: string
  phone: string | null
  email: string | null
  listing_id: string | null
  note: string | null
  assignee_id: string | null
  follow_up_on: string | null
}

export type LeadChange = Partial<{ stage_id: string; assignee_id: string | null; follow_up_on: string | null }>

const leadPath = (orgId: string, leadId: string) => `${oid(orgId)}/leads/${encodeURIComponent(leadId)}`

export const crmApi = {
  board: (orgId: string, signal?: AbortSignal) => request<Crm>(`${oid(orgId)}/crm`, {}, signal),
  /** A lead by id alone; the answer says which org it's in */
  find: (leadId: string, signal?: AbortSignal) => request<Lead>(`/api/business/leads/${encodeURIComponent(leadId)}`, {}, signal),
  add: (orgId: string, input: NewLeadInput) => request<Lead>(`${oid(orgId)}/leads`, { method: 'POST', body: JSON.stringify(input) }),
  update: (orgId: string, leadId: string, change: LeadChange) =>
    request<Lead>(leadPath(orgId, leadId), { method: 'PATCH', body: JSON.stringify(change) }),
  note: (orgId: string, leadId: string, text: string) =>
    request<Lead>(`${leadPath(orgId, leadId)}/notes`, { method: 'POST', body: JSON.stringify({ text }) }),
  reply: (orgId: string, leadId: string, text: string) =>
    request<Lead>(`${leadPath(orgId, leadId)}/messages`, { method: 'POST', body: JSON.stringify({ text }) }),
  remove: (orgId: string, leadId: string) => request<void>(leadPath(orgId, leadId), { method: 'DELETE' }),
}

// Buyer messages ----------------------------------------------------------------------

export interface Thread {
  id: string
  listing: { id: string; title: string } | null
  /** The seller's name, with the business name for business listings */
  seller: string
  last_message: string | null
  last_message_at: string
  /** Seller messages you haven't read */
  unread: number
}

export interface ThreadDetail extends Thread {
  messages: Message[]
}

/** Fired on window after a thread loads, so the nav's new-message count refreshes */
export const MESSAGES_READ = 'smartland:messages-read'

const tid = (id: string) => `/api/messages/${encodeURIComponent(id)}`

export const messagesApi = {
  list: (signal?: AbortSignal) => request<Thread[]>('/api/messages', {}, signal),
  unread: (signal?: AbortSignal) => request<{ count: number }>('/api/messages/unread', {}, signal),
  get: (id: string, signal?: AbortSignal) => request<ThreadDetail>(tid(id), {}, signal),
  send: (id: string, text: string) => request<ThreadDetail>(tid(id), { method: 'POST', body: JSON.stringify({ text }) }),
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
    case 'slow':
      return {
        title: 'This is taking longer than usual',
        body: 'The map service is slow right now. Try again in a minute.',
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

// Team workspace (backend/workspace.py) -------------------------------------------------

export interface WsChannel {
  id: string
  kind: 'channel' | 'dm'
  /** Channels only, without the # */
  name: string | null
  topic: string | null
  /** Messages from others since you last read it */
  unread: number
  /** Of those, the ones that @mention you */
  mentions: number
  last_message_at: string | null
  /** DMs only: the other person */
  with?: { id: string; name: string } | null
}

export interface WsMember {
  id: string
  name: string
  role: OrgRole
}

export interface Workspace {
  channels: WsChannel[]
  members: WsMember[]
  role: OrgRole
}

export interface WsMessage {
  id: string
  channel_id: string
  author: { id: string; name: string } | null
  /** Mentions appear as <@user_id> */
  body: string
  created_at: string
  edited_at: string | null
  deleted: boolean
}

export interface Task {
  id: string
  title: string
  notes: string | null
  assignee: { id: string; name: string } | null
  /** YYYY-MM-DD */
  due_on: string | null
  status: 'open' | 'done'
  lead: { id: string; name: string } | null
  listing: { id: string; title: string } | null
  created_by: string | null
  created_at: string
  done_at: string | null
}

export interface NewTaskInput {
  title: string
  notes?: string | null
  assignee_id?: string | null
  due_on?: string | null
  lead_id?: string | null
  listing_id?: string | null
}

export type TaskChange = Partial<{ title: string; notes: string | null; assignee_id: string | null; due_on: string | null; status: 'open' | 'done' }>

const wsPath = (orgId: string) => `${oid(orgId)}/workspace`

export const workspaceApi = {
  load: (orgId: string, signal?: AbortSignal) => request<Workspace>(wsPath(orgId), {}, signal),
  createChannel: (orgId: string, name: string, topic: string | null) =>
    request<WsChannel>(`${wsPath(orgId)}/channels`, { method: 'POST', body: JSON.stringify({ name, topic }) }),
  updateChannel: (orgId: string, channelId: string, change: Partial<{ name: string; topic: string | null; archived: boolean }>) =>
    request<{ ok: true }>(`${wsPath(orgId)}/channels/${encodeURIComponent(channelId)}`, { method: 'PATCH', body: JSON.stringify(change) }),
  openDm: (orgId: string, userId: string) => request<WsChannel>(`${wsPath(orgId)}/dms`, { method: 'POST', body: JSON.stringify({ user_id: userId }) }),
  /** The newest page, an older page (`before`), or what changed since the last cursor (`since`) */
  messages: (orgId: string, channelId: string, q: { since?: string; before?: string } = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])
    return request<{ messages: WsMessage[]; cursor: string }>(
      `${wsPath(orgId)}/channels/${encodeURIComponent(channelId)}/messages${params.size ? `?${params}` : ''}`,
      {},
      signal,
    )
  },
  post: (orgId: string, channelId: string, body: string) =>
    request<WsMessage>(`${wsPath(orgId)}/channels/${encodeURIComponent(channelId)}/messages`, { method: 'POST', body: JSON.stringify({ body }) }),
  edit: (orgId: string, messageId: string, body: string) =>
    request<WsMessage>(`${wsPath(orgId)}/messages/${encodeURIComponent(messageId)}`, { method: 'PATCH', body: JSON.stringify({ body }) }),
  remove: (orgId: string, messageId: string) => request<void>(`${wsPath(orgId)}/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' }),
  /** New DMs plus new @mentions, for the nav badge */
  unread: (signal?: AbortSignal) => request<{ count: number; by_org: Record<string, number> }>('/api/business/workspace/unread', {}, signal),
  tasks: (orgId: string, q: { status?: 'open' | 'done'; mine?: boolean; lead_id?: string } = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams()
    if (q.status) params.set('status', q.status)
    if (q.mine) params.set('mine', 'true')
    if (q.lead_id) params.set('lead_id', q.lead_id)
    return request<Task[]>(`${wsPath(orgId)}/tasks${params.size ? `?${params}` : ''}`, {}, signal)
  },
  addTask: (orgId: string, input: NewTaskInput) => request<Task>(`${wsPath(orgId)}/tasks`, { method: 'POST', body: JSON.stringify(input) }),
  updateTask: (orgId: string, taskId: string, change: TaskChange) =>
    request<Task>(`${wsPath(orgId)}/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: JSON.stringify(change) }),
  removeTask: (orgId: string, taskId: string) => request<void>(`${wsPath(orgId)}/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' }),
}

// Performance (backend/performance.py) --------------------------------------------------

export type PerformanceDays = 7 | 30 | 90

export interface Performance {
  days: PerformanceDays
  /** First day counted, YYYY-MM-DD in Philippine time */
  since: string
  totals: { visits: number; inquiries: number }
  /** The account's listings, most visited first */
  listings: { id: string; title: string; status: string; visits: number; inquiries: number; videos: number; cover_url: string | null }[]
  /** "direct" when the visitor had no tags and no outside referrer */
  sources: { source: string; visits: number; inquiries: number }[]
  /** Days with at least one visit */
  daily: { day: string; visits: number }[]
}

export const performanceApi = {
  load: (orgId: string, days: PerformanceDays, signal?: AbortSignal) =>
    request<Performance>(`${oid(orgId)}/performance?days=${days}`, {}, signal),
}
