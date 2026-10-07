import { useEffect, useRef } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Bookmark, House, LandPlot, Monitor, Moon, Search, Sun } from 'lucide-react'
import { useTheme, type ThemeChoice } from '../lib/theme'

const THEME_LABEL: Record<ThemeChoice, string> = {
  system: 'Theme: match device. Switch to light',
  light: 'Theme: light. Switch to dark',
  dark: 'Theme: dark. Switch to match device',
}

function ThemeButton() {
  const { choice, cycle } = useTheme()
  const Icon = choice === 'light' ? Sun : choice === 'dark' ? Moon : Monitor
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={THEME_LABEL[choice]}
      title={THEME_LABEL[choice]}
      className="press inline-flex size-tap items-center justify-center rounded-pill text-ink hover:bg-surface-raised"
    >
      <Icon size={20} strokeWidth={1.75} aria-hidden />
    </button>
  )
}

const desktopLink = ({ isActive }: { isActive: boolean }) =>
  `press inline-flex min-h-tap items-center px-sm text-caption ${isActive ? 'text-ink font-semibold' : 'text-ink-secondary hover:text-ink'}`

function TopNav() {
  return (
    <header className="frosted sticky top-0 z-40 border-b border-hairline pt-[env(safe-area-inset-top)]">
      <nav aria-label="Main" className="gutter mx-auto flex h-nav max-w-grid items-center justify-between">
        <Link to="/" className="press -ml-xs inline-flex min-h-tap items-center gap-xs px-xs text-tagline font-semibold text-ink">
          <LandPlot size={22} strokeWidth={1.75} className="text-accent" aria-hidden />
          SmartLand
        </Link>
        <div className="flex items-center gap-xxs">
          <div className="hidden items-center sm:flex">
            <NavLink to="/check" className={desktopLink}>
              Check a location
            </NavLink>
            <NavLink to="/reports" className={desktopLink}>
              Saved reports
            </NavLink>
          </div>
          <ThemeButton />
        </div>
      </nav>
    </header>
  )
}

const tabs = [
  { to: '/', label: 'Home', icon: House, end: true },
  { to: '/check', label: 'Check', icon: Search, end: false },
  { to: '/reports', label: 'Saved', icon: Bookmark, end: false },
]

// HIG tab bar on phones: visible on every top-level screen
function TabBar() {
  return (
    <nav
      aria-label="Main"
      className="frosted fixed inset-x-0 bottom-0 z-40 border-t border-hairline pb-[env(safe-area-inset-bottom)] sm:hidden"
    >
      <ul className="grid grid-cols-3">
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                `press flex min-h-tabbar flex-col items-center justify-center gap-0.5 text-fine-print ${isActive ? 'text-accent' : 'text-ink-secondary'}`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={22} strokeWidth={isActive ? 2.25 : 1.75} aria-hidden />
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

const YEAR = new Date().getFullYear()

function Footer() {
  return (
    <footer className="bg-canvas-alt pb-tabbar-safe pt-xxl text-ink-secondary sm:py-footer">
      <div className="gutter mx-auto flex max-w-grid flex-col gap-lg">
        <p className="max-w-prose text-caption">
          SmartLand estimates come from a scoring model that uses the numbers you enter. They are not an appraisal.
          Check with a licensed appraiser and the local assessor before you buy.
        </p>
        <div className="flex flex-col gap-xs border-t border-hairline pt-lg text-fine-print xs:flex-row xs:justify-between">
          <p>© {YEAR} SmartLand. Prices in Philippine pesos.</p>
          <p>Icons by Lucide</p>
        </div>
      </div>
    </footer>
  )
}

export function Layout() {
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const first = useRef(true)

  // On route change: scroll to top and move focus to the new page for screen readers
  useEffect(() => {
    window.scrollTo(0, 0)
    if (first.current) {
      first.current = false
      return
    }
    mainRef.current?.focus({ preventScroll: true })
  }, [pathname])

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="press sr-only z-50 rounded-pill bg-accent-fill px-btn-x py-sm text-on-accent focus:not-sr-only focus:fixed focus:left-md focus:top-md"
      >
        Skip to content
      </a>
      <TopNav />
      <main id="main" ref={mainRef} tabIndex={-1} className="flex-1 outline-none">
        <Outlet />
      </main>
      <Footer />
      <TabBar />
    </div>
  )
}
