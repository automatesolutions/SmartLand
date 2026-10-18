import { lazy, Suspense, type ComponentProps } from 'react'
import { Skeleton } from './States'

// Leaflet is the largest dependency, so it loads only on pages that show a map
const LotMap = lazy(() => import('./LotMap').then((m) => ({ default: m.LotMap })))
const PinMap = lazy(() => import('./PinMap').then((m) => ({ default: m.PinMap })))

export function MapView(props: ComponentProps<typeof LotMap>) {
  return (
    <Suspense fallback={<Skeleton className={`w-full ${props.className ?? 'h-72 rounded-lg sm:h-80'}`} />}>
      <LotMap {...props} />
    </Suspense>
  )
}

export function PinMapView(props: ComponentProps<typeof PinMap>) {
  return (
    <Suspense fallback={<Skeleton className={`w-full ${props.className ?? 'h-80 rounded-lg sm:h-96'}`} />}>
      <PinMap {...props} />
    </Suspense>
  )
}
