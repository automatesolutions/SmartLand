import { MapPin } from 'lucide-react'

/**
 * Plan-view illustration: contour lines, two roads, and lot parcels with one
 * highlighted lot. Plain SVG primitives so it stays editable; colours come
 * from theme tokens so it follows light and dark mode.
 */
const parcels: [number, number, number, number][] = [
  [64, 70, 120, 90], [196, 70, 96, 90], [304, 70, 140, 90],
  [64, 232, 150, 96], [226, 232, 110, 96], [348, 232, 96, 96],
  [536, 70, 110, 120], [658, 70, 130, 120], [800, 70, 96, 120],
  [536, 262, 150, 66], [698, 262, 92, 66], [802, 262, 94, 66],
]
const highlighted = 7

export function ParcelMap({ className = '' }: { className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <svg viewBox="0 0 960 400" role="img" aria-labelledby="parcel-map-title" className="block h-auto w-full">
        <title id="parcel-map-title">Map of land parcels along two roads, with one lot highlighted</title>
        <rect width="960" height="400" rx="18" fill="var(--sl-surface)" />
        {/* Contour lines */}
        <g fill="none" stroke="var(--sl-hairline)" strokeWidth="1.5">
          <path d="M-20 120 C 140 60, 300 180, 480 110 S 820 40, 980 130" />
          <path d="M-20 170 C 160 110, 320 230, 500 160 S 820 90, 980 180" />
          <path d="M-20 300 C 180 250, 340 360, 520 300 S 840 230, 980 320" />
          <path d="M-20 350 C 200 300, 360 410, 540 350 S 860 280, 980 370" />
        </g>
        {/* Roads */}
        <g fill="var(--sl-canvas-alt)" stroke="var(--sl-hairline)" strokeWidth="1.5">
          <rect x="-2" y="180" width="964" height="36" />
          <rect x="468" y="-2" width="44" height="404" />
        </g>
        <g stroke="var(--sl-ink-secondary)" strokeWidth="1.5" strokeDasharray="10 12" opacity="0.5">
          <line x1="0" y1="198" x2="468" y2="198" />
          <line x1="512" y1="198" x2="960" y2="198" />
          <line x1="490" y1="0" x2="490" y2="180" />
          <line x1="490" y1="216" x2="490" y2="400" />
        </g>
        {/* Parcels */}
        <g strokeWidth="1.5">
          {parcels.map(([x, y, w, h], i) => (
            <rect
              key={i}
              x={x}
              y={y}
              width={w}
              height={h}
              rx="8"
              fill={i === highlighted ? 'color-mix(in srgb, var(--sl-accent) 14%, transparent)' : 'var(--sl-surface-raised)'}
              stroke={i === highlighted ? 'var(--sl-accent)' : 'var(--sl-hairline)'}
              strokeWidth={i === highlighted ? 2.5 : 1.5}
            />
          ))}
        </g>
      </svg>
      {/* Pin sits over the highlighted lot (x 658..788, y 70..190 of 960x400) */}
      <span
        aria-hidden
        className="absolute flex -translate-x-1/2 -translate-y-full text-accent"
        style={{ left: `${((658 + 65) / 960) * 100}%`, top: `${((70 + 60) / 400) * 100}%` }}
      >
        <MapPin size={36} strokeWidth={2} fill="var(--sl-surface)" />
      </span>
    </div>
  )
}
