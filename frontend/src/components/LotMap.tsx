import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Amenity, Comp } from '../lib/api'
import { AMENITY_LABEL } from '../lib/presets'

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
  amenities = [],
  comps = [],
  className = '',
}: {
  lat: number
  lon: number
  label: string
  amenities?: Amenity[]
  comps?: Comp[]
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
  }, [lat, lon, label, amenities, comps])

  return (
    <div
      ref={el}
      role="region"
      aria-label={`Map of ${label} with nearby amenities`}
      className={`isolate h-72 w-full overflow-hidden rounded-lg border border-hairline bg-surface-raised sm:h-80 ${className}`}
    />
  )
}
