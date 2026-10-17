import { lazy, Suspense, type ComponentProps } from 'react'
import { Skeleton } from './States'

// Leaflet is the largest dependency, so it loads only on pages that show a map
const LotMap = lazy(() => import('./LotMap').then((m) => ({ default: m.LotMap })))

export function MapView(props: ComponentProps<typeof LotMap>) {
  return (
    <Suspense fallback={<Skeleton className="h-72 w-full rounded-lg sm:h-80" />}>
      <LotMap {...props} />
    </Suspense>
  )
}
