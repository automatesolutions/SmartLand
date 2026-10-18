import { useEffect, useState } from 'react'
import { Building2, House, KeyRound, LandPlot, Landmark, Tractor, TreePalm, Warehouse, type LucideIcon } from 'lucide-react'
import { listingsApi, type DetailValue, type FieldSpec, type Listing, type ListingCategory, type ListingSchema, type SellerType } from './api'
import { formatPeso } from './format'

export interface CategorySpec {
  key: ListingCategory
  /** URL segment, as in /listings/farm-lots */
  slug: string
  label: string
  /** "a farm lot", for sentences such as "Post a farm lot" */
  one: string
  /** Rentals and leases are priced per month */
  rent: boolean
  icon: LucideIcon
  /** What the outside portal search asks for */
  query: string
  /** One line on the post-a-listing picker */
  blurb: string
}

// Keys match listing_rules.CATEGORIES in the backend
export const CATEGORIES: CategorySpec[] = [
  { key: 'farm_lot', slug: 'farm-lots', label: 'Farm lots for sale', one: 'a farm lot', rent: false, icon: Tractor, query: '"farm lot" for sale', blurb: 'Area, crops, terrain, road, water, and power.' },
  { key: 'house_sale', slug: 'houses-for-sale', label: 'Houses for sale', one: 'a house', rent: false, icon: House, query: '"house and lot" for sale', blurb: 'Lot and floor area, rooms, parking, and year built.' },
  { key: 'house_rent', slug: 'houses-for-rent', label: 'Houses for rent', one: 'a house for rent', rent: true, icon: KeyRound, query: '"house for rent"', blurb: 'Monthly rent, rooms, deposit, advance, and lease length.' },
  { key: 'land_lease', slug: 'land-for-lease', label: 'Land for rent or lease', one: 'land for lease', rent: true, icon: LandPlot, query: '"lot for lease" OR "land for rent"', blurb: 'Area, allowed use, lease length, and road access.' },
  { key: 'commercial_sale', slug: 'commercial-and-warehouses', label: 'Commercial buildings and warehouses for sale', one: 'a commercial building or warehouse', rent: false, icon: Building2, query: '"commercial building" OR warehouse for sale', blurb: 'Lot and floor area, frontage, ceiling, and loading bays.' },
  { key: 'warehouse_lease', slug: 'warehouses-for-lease', label: 'Warehouses for lease', one: 'a warehouse for lease', rent: true, icon: Warehouse, query: 'warehouse for lease', blurb: 'Floor area, ceiling, truck access, power, and lease terms.' },
  { key: 'beach', slug: 'beach-property', label: 'Beach property', one: 'a beach property', rent: false, icon: TreePalm, query: '"beach lot" OR beachfront for sale', blurb: 'Lot area, beach frontage, shore, and utilities.' },
  { key: 'foreclosure', slug: 'foreclosures', label: 'Pag-IBIG and bank foreclosures', one: 'a foreclosed property', rent: false, icon: Landmark, query: 'Pag-IBIG acquired assets OR bank foreclosed property', blurb: 'For banks and Pag-IBIG: area, occupancy, and bidding date.' },
]

export const categoryBySlug = (slug: string) => CATEGORIES.find((c) => c.slug === slug)
export const categoryByKey = (key: ListingCategory) => CATEGORIES.find((c) => c.key === key)!

export const SELLER_LABEL: Record<SellerType, string> = {
  owner: 'Owner',
  broker: 'Licensed broker',
  developer: 'Developer',
  bank: 'Bank or Pag-IBIG',
}

export const RADII_KM = [5, 10, 25, 50]

/** "₱2,500,000" or "₱15,000 a month" */
export function listingPrice(l: Pick<Listing, 'price' | 'category'>): string {
  return categoryByKey(l.category).rent ? `${formatPeso(l.price)} a month` : formatPeso(l.price)
}

/** Price per sqm of lot, for sales with a lot size */
export function pricePerSqm(l: Pick<Listing, 'price' | 'category' | 'lot_sqm'>): number | null {
  if (categoryByKey(l.category).rent || !l.lot_sqm) return null
  return Math.round(l.price / l.lot_sqm)
}

export function formatArea(sqm: number): string {
  return sqm >= 10000 ? `${(sqm / 10000).toLocaleString('en-PH', { maximumFractionDigits: 2 })} ha` : `${sqm.toLocaleString('en-PH')} sqm`
}

export const km = (d: number) => (d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`)

// Outside portals, searched through Google with a site filter so the links
// keep working when a portal changes its own URLs
const SALE_SITES = ['lamudi.com.ph', 'dotproperty.com.ph']
const RENT_SITES = [...SALE_SITES, 'rentpad.com.ph']

export function portalSearchUrl(c: CategorySpec, town: string, province?: string | null): string {
  const place = province && province !== town ? `"${town}" ${province}` : `"${town}"`
  if (c.key === 'foreclosure') return `https://www.google.com/search?q=${encodeURIComponent(`${c.query} ${place}`)}`
  const filter = (c.rent ? RENT_SITES : SALE_SITES).map((s) => `site:${s}`).join(' OR ')
  return `https://www.google.com/search?q=${encodeURIComponent(`${c.query} ${place} (${filter})`)}`
}

/** Where a listings page searches: a point, the town name for headings, and a radius */
export interface Near {
  lat: number
  lon: number
  town: string
  province: string | null
}

export function nearParams(n: Near, radius?: number): string {
  const p = new URLSearchParams({ lat: n.lat.toFixed(5), lon: n.lon.toFixed(5), near: n.town })
  if (n.province) p.set('province', n.province)
  if (radius) p.set('r', String(radius))
  return p.toString()
}

export function readNear(params: URLSearchParams): Near | null {
  const lat = Number(params.get('lat'))
  const lon = Number(params.get('lon'))
  if (!params.get('lat') || !params.get('lon') || !Number.isFinite(lat) || !Number.isFinite(lon)) return null
  return { lat, lon, town: params.get('near') || 'the lot', province: params.get('province') }
}

// Schema ----------------------------------------------------------------------

let schemaCache: Promise<ListingSchema> | null = null

/** The fields and documents each kind of listing asks for, fetched once per visit */
export function useListingSchema(): ListingSchema | null {
  const [schema, setSchema] = useState<ListingSchema | null>(null)
  useEffect(() => {
    let live = true
    schemaCache ??= listingsApi.schema().catch((err) => {
      schemaCache = null
      throw err
    })
    schemaCache.then((s) => live && setSchema(s)).catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return schema
}

/** A detail as people read it: "3", "Yes", "4.5 m", "Concrete road" */
export function formatDetail(field: FieldSpec, value: DetailValue): string {
  if (field.type === 'bool') return value ? 'Yes' : 'No'
  if (field.type === 'date' && typeof value === 'string') return new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', { dateStyle: 'medium' })
  if (field.type === 'number' && typeof value === 'number') return `${value.toLocaleString('en-PH')}${field.unit ? ` ${field.unit}` : ''}`
  return String(value)
}

// Fingerprints ----------------------------------------------------------------

/** SHA-256 of a file, worked out in the browser. The file never leaves the device. */
export async function fingerprint(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** First and last characters, enough to compare by eye */
export const shortHash = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`

/** Opens a private document in a new tab, for the seller and reviewers */
export async function openDocument(listingId: string, docId: string) {
  // Open the tab first, while the click still counts, then point it at the file
  const tab = window.open('', '_blank')
  try {
    const blob = await listingsApi.documentFile(listingId, docId)
    const url = URL.createObjectURL(blob)
    if (tab) tab.location.href = url
    else window.location.href = url
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (err) {
    tab?.close()
    throw err
  }
}
