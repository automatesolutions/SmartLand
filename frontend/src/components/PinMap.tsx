import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Amenity } from '../lib/api'
import { AMENITY_LABEL } from '../lib/presets'

// Shows the whole country until there's a pin
const PH_CENTER: L.LatLngTuple = [12.3, 122.5]
// Stable default, so the amenity layer redraws only when the list changes
const NO_AMENITIES: Amenity[] = []

function token(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function escape(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function pointKey(lat: number, lon: number): string {
  return `${lat.toFixed(5)},${lon.toFixed(5)}`
}

function pinIcon(): L.DivIcon {
  const accent = token('--sl-accent-fill', '#0066cc')
  const surface = token('--sl-surface', '#ffffff')
  return L.divIcon({
    className: '',
    iconSize: [32, 42],
    iconAnchor: [16, 41],
    html: `<svg width="32" height="42" viewBox="0 0 32 42" style="filter:drop-shadow(0 2px 3px rgb(0 0 0 / 0.35))"><path d="M16 1C7.7 1 1 7.6 1 15.8 1 27 16 41 16 41s15-14 15-25.2C31 7.6 24.3 1 16 1z" fill="${accent}" stroke="${surface}" stroke-width="2"/><circle cx="16" cy="16" r="5.5" fill="${surface}"/></svg>`,
  })
}

/**
 * Map for marking the exact lot. Clicking the map or dragging the pin calls
 * onPick. The map stays mounted, so moving the pin doesn't reset the view.
 */
export function PinMap({
  point,
  zoom = 16,
  amenities = NO_AMENITIES,
  onPick,
  center,
  className = 'h-80 rounded-lg border border-hairline sm:h-96',
}: {
  point: { lat: number; lon: number } | null
  /** Where the map opens before there's a pin, such as the town a listing is in */
  center?: { lat: number; lon: number }
  /** Zoom used when the point comes from a search rather than the map */
  zoom?: number
  amenities?: Amenity[]
  onPick: (lat: number, lon: number) => void
  /** Size and frame of the map */
  className?: string
}) {
  const el = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const amenityLayer = useRef<L.LayerGroup | null>(null)
  // The last point picked on the map itself, so the view stays where the person left it
  const pickedRef = useRef<string | null>(null)
  const onPickRef = useRef(onPick)
  // Only the first value matters: it sets where the map opens
  const centerRef = useRef(center)

  useEffect(() => {
    onPickRef.current = onPick
  }, [onPick])

  useEffect(() => {
    if (!el.current) return
    // Zoom buttons sit top right, clear of the search bar laid over the map
    const start = centerRef.current
    const map = L.map(el.current, { zoomControl: false }).setView(start ? [start.lat, start.lon] : PH_CENTER, start ? 14 : 6)
    L.control.zoom({ position: 'topright' }).addTo(map)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map)
    amenityLayer.current = L.layerGroup().addTo(map)

    const marker = L.marker(PH_CENTER, { icon: pinIcon(), draggable: true, autoPan: true, alt: 'Pin on the lot', title: 'Drag to move' })
    const pick = (ll: L.LatLng) => {
      const p = ll.wrap()
      pickedRef.current = pointKey(p.lat, p.lng)
      marker.setLatLng(p)
      if (!map.hasLayer(marker)) marker.addTo(map)
      onPickRef.current(p.lat, p.lng)
    }
    marker.on('dragend', () => pick(marker.getLatLng()))
    map.on('click', (e: L.LeafletMouseEvent) => pick(e.latlng))

    mapRef.current = map
    markerRef.current = marker
    // Leaflet measures the container once; re-measure after layout settles
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(el.current)
    return () => {
      ro.disconnect()
      map.remove()
      mapRef.current = null
      markerRef.current = null
    }
  }, [])

  const lat = point?.lat
  const lon = point?.lon
  useEffect(() => {
    const map = mapRef.current
    const marker = markerRef.current
    if (!map || !marker) return
    if (lat == null || lon == null) {
      marker.remove()
      return
    }
    marker.setLatLng([lat, lon])
    if (!map.hasLayer(marker)) marker.addTo(map)
    // A search or "Use my location" moved the point, so bring it into view
    if (pickedRef.current !== pointKey(lat, lon)) map.setView([lat, lon], zoom)
  }, [lat, lon, zoom])

  useEffect(() => {
    const layer = amenityLayer.current
    if (!layer) return
    layer.clearLayers()
    const ink = token('--sl-ink-secondary', '#6e6e73')
    const surface = token('--sl-surface', '#ffffff')
    for (const a of amenities) {
      L.circleMarker([a.lat, a.lon], { radius: 6, color: surface, weight: 2, fillColor: ink, fillOpacity: 1 })
        .bindTooltip(`${AMENITY_LABEL[a.type]}${a.name ? `: ${escape(a.name)}` : ''} · ${a.distance_km} km`)
        .addTo(layer)
    }
  }, [amenities])

  return (
    <div
      ref={el}
      role="region"
      aria-label="Map. Click the map to put the pin on the lot."
      className={`isolate w-full overflow-hidden bg-surface-raised ${className}`}
    />
  )
}
