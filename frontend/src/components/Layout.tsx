import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { LandPlot, Menu, Moon, Sun, X } from 'lucide-react'
import { useTheme, type ThemeChoice } from '../lib/theme'
import { useUser } from '../lib/auth'
import { ButtonLink } from './Button'

const THEME_LABEL: Record<ThemeChoice, string> = {
  light: 'Switch to dark mode',
  dark: 'Switch to light mode',
}

function ThemeButton() {
  const { choice, cycle } = useTheme()
  const Icon = choice === 'light' ? Moon : Sun
  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={THEME_LABEL[choice]}
      title={THEME_LABEL[choice]}
      className="press inline-flex size-tap items-center justify-center rounded-pill text-on-tile"
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden />
    </button>
  )
}

const navLink = ({ isActive }: { isActive: boolean }) =>
  `press inline-flex min-h-tap items-center px-sm text-fine-print tracking-[-0.0075rem] ${
    isActive ? 'text-on-tile' : 'text-on-tile-secondary hover:text-on-tile'
  }`

const trayLink = ({ isActive }: { isActive: boolean }) =>
  `flex min-h-tap items-center border-b border-tile-hairline text-tagline font-semibold ${
    isActive ? 'text-on-tile' : 'text-on-tile-secondary hover:text-on-tile'
  }`

function GlobalNav() {
  const user = useUser()
  const { pathname } = useLocation()
  // The tray belongs to the page it was opened on, so navigating closes it
  const [openOn, setOpenOn] = useState<string | null>(null)
  const open = openOn === pathname
  const setOpen = (next: boolean) => setOpenOn(next ? pathname : null)
  const links = [
    { to: '/check', label: 'Check' },
    { to: '/reports', label: 'Saved' },
    { to: '/account', label: user ? 'Account' : 'Sign in' },
  ]

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenOn(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <header className="sticky top-0 z-50 bg-black pt-[env(safe-area-inset-top)] print:hidden">
      <nav aria-label="Main" className="gutter mx-auto flex h-nav max-w-grid items-center justify-between">
        <Link
          to="/"
          className="press -ml-xs inline-flex min-h-tap items-center gap-xs px-xs text-fine-print text-on-tile"
        >
          <LandPlot size={16} strokeWidth={1.75} aria-hidden />
          SmartLand
        </Link>
        <div className="flex items-center">
          {/* Full link row from 834px, per DESIGN.md */}
          <div className="hidden items-center md:flex">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} className={navLink}>
                {l.label}
              </NavLink>
            ))}
          </div>
          <ThemeButton />
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls="nav-tray"
            aria-label={open ? 'Close menu' : 'Open menu'}
            className="press inline-flex size-tap items-center justify-center rounded-pill text-on-tile md:hidden"
          >
            {open ? <X size={18} strokeWidth={1.75} aria-hidden /> : <Menu size={18} strokeWidth={1.75} aria-hidden />}
          </button>
        </div>
      </nav>
      {open && (
        <div id="nav-tray" className="gutter border-t border-tile-hairline bg-black pb-lg md:hidden">
          <ul className="mx-auto max-w-grid">
            {links.map((l) => (
              <li key={l.to}>
                <NavLink to={l.to} className={trayLink}>
                  {l.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  )
}

const SUBNAV_TITLES: [RegExp, string][] = [
  [/^\/reports\/.+/, 'Report'],
  [/^\/reports/, 'Saved reports'],
  [/^\/shared/, 'Shared report'],
  [/^\/account/, 'Account'],
  [/^\/check/, 'Check a location'],
  [/^\/listings\/new/, 'Post a listing'],
  [/^\/listings\/mine/, 'Your listings'],
  [/^\/listings\//, 'Listings'],
  [/^\/listing\//, 'Listing'],
  [/^\/reviews/, 'Document reviews'],
]

function SubNav() {
  const { pathname } = useLocation()
  if (pathname === '/') return null
  const title = SUBNAV_TITLES.find(([re]) => re.test(pathname))?.[1] ?? 'SmartLand'
  return (
    <div className="frosted print:hidden sticky top-[calc(var(--spacing-nav)+env(safe-area-inset-top))] z-40">
      <div className="gutter mx-auto flex h-subnav max-w-grid items-center justify-between gap-sm">
        <p className="truncate text-tagline font-semibold">{title}</p>
        {pathname !== '/check' && (
          <ButtonLink to="/check" className="shrink-0">
            Check a location
          </ButtonLink>
        )}
      </div>
    </div>
  )
}

const YEAR = new Date().getFullYear()

const FOOTER = [
  {
    heading: 'Check land',
    links: [
      { to: '/check', label: 'Check a location' },
      { to: '/reports', label: 'Saved reports' },
      { to: '/account', label: 'Account' },
      { to: '/#how', label: 'How it works' },
    ],
  },
  {
    heading: 'The report',
    links: [
      { to: '/#outputs', label: 'Price per sqm' },
      { to: '/#outputs', label: 'Growth score' },
      { to: '/#grades', label: 'Investment grade' },
    ],
  },
]

function Footer() {
  return (
    <footer className="print:hidden bg-canvas-alt pb-[max(4rem,env(safe-area-inset-bottom))] pt-footer text-ink-secondary">
      <div className="gutter mx-auto flex max-w-reading flex-col gap-xl">
        <p className="text-fine-print">
          SmartLand estimates come from reference prices for nearby areas, OpenStreetMap, regional figures, and news.
          They are not an appraisal. Check with a licensed appraiser and the local assessor before you buy.
        </p>
        <div className="grid gap-xl sm:grid-cols-2">
          {FOOTER.map((col) => (
            <div key={col.heading}>
              <p className="text-caption font-semibold text-ink">{col.heading}</p>
              <ul className="mt-xs">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link to={l.to} className="press inline-flex min-h-tap items-center text-body leading-[2.41] text-ink-secondary hover:text-ink">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-xs border-t border-hairline pt-lg text-fine-print text-ink-disabled xs:flex-row xs:justify-between">
          <p>Copyright © {YEAR} SmartLand. All rights reserved. Prices in Philippine pesos.</p>
          <p>Map data © OpenStreetMap contributors · Icons by Lucide</p>
        </div>
      </div>
    </footer>
  )
}

export function Layout() {
  const { pathname } = useLocation()
  const mainRef = useRef<HTMLElement>(null)
  const first = useRef(true)

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
      <GlobalNav />
      <SubNav />
      <main id="main" ref={mainRef} tabIndex={-1} className="flex-1 outline-none">
        <Outlet />
      </main>
      <Footer />
    </div>
  )
}
