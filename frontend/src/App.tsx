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

const TITLES: [RegExp, string][] = [
  [/^\/$/, 'SmartLand: know what land is worth'],
  [/^\/check/, 'Check a location · SmartLand'],
  [/^\/reports\/.+/, 'Report · SmartLand'],
  [/^\/reports/, 'Saved reports · SmartLand'],
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
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
