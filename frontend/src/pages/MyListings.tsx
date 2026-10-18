import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ClipboardList, Plus, RotateCw, UserRound } from 'lucide-react'
import { listingsApi, type Listing } from '../lib/api'
import { useUser } from '../lib/auth'
import { Button, ButtonLink } from '../components/Button'
import { ListingCard } from '../components/ListingCard'
import { EmptyState, Skeleton } from '../components/States'

/** The listings the signed-in person posted, active and sold */
export function MyListingsPage() {
  const user = useUser()
  const { pathname } = useLocation()
  const [listings, setListings] = useState<Listing[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!user) return
    let live = true
    listingsApi
      .mine()
      .then((l) => live && setListings(l))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [user, attempt])

  if (!user) {
    return (
      <EmptyState
        as="h1"
        icon={UserRound}
        title="Sign in to see your listings"
        body="Listings belong to the account that posted them."
        action={
          <ButtonLink to="/account" state={{ from: pathname }}>
            Sign in
          </ButtonLink>
        }
      />
    )
  }

  return (
    <div className="gutter mx-auto flex max-w-reading flex-col gap-lg py-xxl sm:py-section">
      <header className="flex flex-col gap-sm sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-xxs">
          <h1 className="text-display-md">Your listings</h1>
          <p role="status" className="text-ink-secondary">
            {listings
              ? `${listings.filter((l) => l.status === 'active').length} on sale, ${listings.filter((l) => l.status === 'sold').length} sold.`
              : failed
                ? ''
                : 'Loading your listings.'}
          </p>
        </div>
        <ButtonLink to="/listings/new" className="self-start sm:self-auto" icon={<Plus size={18} aria-hidden />}>
          Post a listing
        </ButtonLink>
      </header>

      {failed && !listings ? (
        <div className="flex flex-col items-start gap-sm rounded-lg border border-hairline bg-surface p-lg">
          <p className="font-semibold">We couldn't load your listings</p>
          <p className="text-ink-secondary">Check your connection, then try again.</p>
          <Button
            variant="secondary"
            onClick={() => {
              setFailed(false)
              setAttempt((n) => n + 1)
            }}
            icon={<RotateCw size={18} aria-hidden />}
          >
            Try again
          </Button>
        </div>
      ) : !listings ? (
        <div aria-hidden className="flex flex-col gap-sm">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-32 w-full rounded-lg" />
        </div>
      ) : listings.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No listings yet"
          body="Post a property and people who check a location nearby will see it."
          action={<ButtonLink to="/listings/new">Post a listing</ButtonLink>}
        />
      ) : (
        <ul className="flex flex-col gap-sm">
          {listings.map((l) => (
            <li key={l.id}>
              <ListingCard listing={l} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
