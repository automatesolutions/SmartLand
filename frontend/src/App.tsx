import { useEffect } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { MapPinOff } from 'lucide-react'
import { Layout } from './components/Layout'
import { ButtonLink } from './components/Button'
import { EmptyState } from './components/States'
import { HomePage } from './pages/Home'
import { CheckPage } from './pages/Check'
import { ReportPage } from './pages/Report'
import { ReportsPage } from './pages/Reports'
import { AccountPage } from './pages/Account'
import { SharedPage } from './pages/Shared'
import { ListingsPage } from './pages/Listings'
import { ListingPage } from './pages/Listing'
import { NewListingPage, NewListingPickerPage } from './pages/NewListing'
import { ReviewsPage } from './pages/Reviews'
import { MyListingsPage } from './pages/MyListings'

const TITLES: [RegExp, string][] = [
  [/^\/$/, 'SmartLand: know what land is worth'],
  [/^\/check/, 'Check a location · SmartLand'],
  [/^\/reports\/.+/, 'Report · SmartLand'],
  [/^\/reports/, 'Saved reports · SmartLand'],
  [/^\/shared/, 'Shared report · SmartLand'],
  [/^\/account/, 'Account · SmartLand'],
  [/^\/listings\/new/, 'Post a listing · SmartLand'],
  [/^\/listings\/mine/, 'Your listings · SmartLand'],
  [/^\/listings\//, 'Listings · SmartLand'],
  [/^\/listing\//, 'Listing · SmartLand'],
  [/^\/reviews/, 'Document reviews · SmartLand'],
]

function DocumentTitle() {
  const { pathname } = useLocation()
  useEffect(() => {
    document.title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? 'Page not found · SmartLand'
  }, [pathname])
  return null
}

function NotFound() {
  return (
    <EmptyState
      as="h1"
      icon={MapPinOff}
      title="This page doesn't exist"
      body="The link may be old or mistyped."
      action={<ButtonLink to="/">Go to the home page</ButtonLink>}
    />
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <DocumentTitle />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="check" element={<CheckPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="reports/:id" element={<ReportPage />} />
          <Route path="shared/:token" element={<SharedPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="listings/new" element={<NewListingPickerPage />} />
          <Route path="listings/new/:slug" element={<NewListingPage />} />
          <Route path="reviews" element={<ReviewsPage />} />
          <Route path="listings/mine" element={<MyListingsPage />} />
          <Route path="listings/:slug" element={<ListingsPage />} />
          <Route path="listing/:id" element={<ListingPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
