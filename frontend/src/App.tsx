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
import { BusinessPage } from './pages/business/Overview'
import { NewOrgPage } from './pages/business/NewOrg'
import { TeamPage } from './pages/business/Team'
import { InvitePage } from './pages/Invite'
import { LeadsPage } from './pages/business/Leads'
import { LeadPage } from './pages/business/Lead'
import { MessagesPage, ThreadPage } from './pages/Messages'
import { PrivacyPage } from './pages/Privacy'

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
  [/^\/business\/new/, 'Create a business account · SmartLand'],
  [/^\/business\/team/, 'Team · SmartLand'],
  [/^\/business\/leads/, 'Leads · SmartLand'],
  [/^\/business/, 'Business account · SmartLand'],
  [/^\/invite\//, 'Join a business account · SmartLand'],
  [/^\/messages/, 'Messages · SmartLand'],
  [/^\/privacy/, 'Privacy notice · SmartLand'],
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
          <Route path="listings" element={<ListingsPage />} />
          <Route path="listings/mine" element={<MyListingsPage />} />
          <Route path="listings/:slug" element={<ListingsPage />} />
          <Route path="listing/:id" element={<ListingPage />} />
          <Route path="business" element={<BusinessPage />} />
          <Route path="business/new" element={<NewOrgPage />} />
          <Route path="business/team" element={<TeamPage />} />
          <Route path="business/leads" element={<LeadsPage />} />
          <Route path="business/leads/:id" element={<LeadPage />} />
          <Route path="invite/:token" element={<InvitePage />} />
          <Route path="messages" element={<MessagesPage />} />
          <Route path="messages/:id" element={<ThreadPage />} />
          <Route path="privacy" element={<PrivacyPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
