import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Amenity, Comp } from '../lib/api'
import { AMENITY_LABEL } from '../lib/presets'

/** A numbered marker. `n` can list several numbers, such as "1, 4", when places share a building */
export interface MapPlace {
  n: string
  lat: number
  lon: number
  label: string
}

// Stable defaults, so the map is rebuilt only when its data changes
const NO_AMENITIES: Amenity[] = []
const NO_COMPS: Comp[] = []
const NO_PLACES: MapPlace[] = []

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

function escape(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

/**
 * Map of the lot, the nearest amenities, and the reference areas used for the
 * price. Everything on it is also listed in text on the page.
 */
export function LotMap({
  lat,
  lon,
  label,
  amenities = NO_AMENITIES,
  comps = NO_COMPS,
  places = NO_PLACES,
  className = 'h-72 rounded-lg border border-hairline sm:h-80',
}: {
  lat: number
  lon: number
  label: string
  amenities?: Amenity[]
  comps?: Comp[]
  /** Numbered markers, such as the offices to visit. The number matches a list on the page. */
  places?: MapPlace[]
  /** Size and frame of the map */
  className?: string
}) {
  const el = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!el.current) return
    const map = L.map(el.current, { scrollWheelZoom: false, attributionControl: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map)

    const accent = token('--sl-accent-fill') || '#0066cc'
    const ink = token('--sl-ink-secondary') || '#6e6e73'
    const surface = token('--sl-surface') || '#ffffff'
    const bounds = L.latLngBounds([[lat, lon]])

    // Reference areas: hollow rings, so they read as "context", not "here"
    for (const c of comps.slice(0, 3)) {
      L.circleMarker([c.lat, c.lon], { radius: 7, color: ink, weight: 2, fillOpacity: 0 })
        .bindTooltip(`${escape(c.name)} · reference area, ${c.distance_km} km`)
        .addTo(map)
      if (c.distance_km < 40) bounds.extend([c.lat, c.lon])
    }
    for (const a of amenities) {
      L.circleMarker([a.lat, a.lon], { radius: 6, color: surface, weight: 2, fillColor: ink, fillOpacity: 1 })
        .bindTooltip(`${AMENITY_LABEL[a.type]}${a.name ? `: ${escape(a.name)}` : ''} · ${a.distance_km} km`)
        .addTo(map)
      bounds.extend([a.lat, a.lon])
    }
    const solid = token('--sl-ink') || '#1d1d1f'
    for (const p of places) {
      const width = Math.max(28, 12 + p.n.length * 8)
      const icon = L.divIcon({
        className: '',
        iconSize: [width, 28],
        iconAnchor: [width / 2, 14],
        html: `<span style="display:flex;width:${width}px;height:28px;align-items:center;justify-content:center;border-radius:9999px;background:${solid};color:${surface};border:2px solid ${surface};font:600 13px/1 var(--sl-font)">${escape(p.n)}</span>`,
      })
      L.marker([p.lat, p.lon], { icon, alt: `${p.n}. ${p.label}`, keyboard: false })
        .bindTooltip(`${p.n}. ${escape(p.label)}`)
        .addTo(map)
      bounds.extend([p.lat, p.lon])
    }
    // A soft halo under the lot so it stands out from the context markers
    L.circleMarker([lat, lon], { radius: 22, stroke: false, fillColor: accent, fillOpacity: 0.18, interactive: false }).addTo(map)
    L.circleMarker([lat, lon], { radius: 10, color: surface, weight: 3, fillColor: accent, fillOpacity: 1 })
      .bindTooltip(escape(label), { permanent: false })
      .addTo(map)

    map.fitBounds(bounds.pad(0.2), { maxZoom: 15 })
    // Leaflet measures the container once; re-measure after layout settles
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      map.remove()
    }
  }, [lat, lon, label, amenities, comps, places])

  return (
    <div
      ref={el}
      role="region"
      aria-label={`Map of ${label} with nearby amenities`}
      className={`isolate w-full overflow-hidden bg-surface-raised ${className}`}
    />
  )
}
