import type { Ref } from './api'

// Where a visitor came from, for the performance page (backend/performance.py).
// captureRef() runs once on load: UTM tags win, then click IDs that apps add, then the
// referrer. The answer lasts for the browser session, so it follows the visitor from
// the page they landed on to the listing they ask about. Nothing here identifies anyone.

const REF_KEY = 'smartland:ref'
const VISITED_KEY = 'smartland:visited'
const DIRECT: Ref = { source: 'direct', medium: '', campaign: '' }

/** The share links each listing offers, in this order */
export const SHARE_SOURCES = [
  { source: 'facebook', medium: 'social', label: 'Facebook' },
  { source: 'tiktok', medium: 'video', label: 'TikTok' },
  { source: 'instagram', medium: 'social', label: 'Instagram' },
  { source: 'youtube', medium: 'video', label: 'YouTube' },
  { source: 'messenger', medium: 'chat', label: 'Messenger' },
  { source: 'flyer', medium: 'print', label: 'Flyer' },
] as const

const LABELS: Record<string, string> = { direct: 'Direct', google: 'Google', ...Object.fromEntries(SHARE_SOURCES.map((s) => [s.source, s.label])) }

/** "facebook" → "Facebook"; anything else as tagged */
export function sourceLabel(source: string): string {
  return LABELS[source] ?? source
}

// Click IDs that apps add to outgoing links, for visits without UTM tags
const CLICK_IDS: [string, string][] = [
  ['fbclid', 'facebook'],
  ['ttclid', 'tiktok'],
  ['gclid', 'google'],
]

// Referrer hosts we name; any other outside site counts under its own host
const HOSTS: [RegExp, string][] = [
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'facebook'],
  [/(^|\.)messenger\.com$/, 'messenger'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)google\.[a-z.]+$/, 'google'],
]

function read(): Ref | null {
  try {
    const raw = sessionStorage.getItem(REF_KEY)
    return raw ? (JSON.parse(raw) as Ref) : null
  } catch {
    return null
  }
}

function save(ref: Ref) {
  try {
    sessionStorage.setItem(REF_KEY, JSON.stringify(ref))
  } catch {
    // Storage blocked: this page still knows, the next one counts as direct
  }
}

function fromReferrer(): Ref | null {
  let host: string
  try {
    host = new URL(document.referrer).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
  if (!host || host === location.hostname) return null
  const named = HOSTS.find(([re]) => re.test(host))
  return { source: named ? named[1] : host, medium: 'referral', campaign: '' }
}

/** Runs once before React renders. Keeps where the visitor came from and tidies the address bar. */
export function captureRef() {
  const params = new URLSearchParams(location.search)
  const tagged = params.get('utm_source')
  if (tagged) {
    save({ source: tagged, medium: params.get('utm_medium') ?? '', campaign: params.get('utm_campaign') ?? '' })
  } else if (!read()) {
    const clicked = CLICK_IDS.find(([key]) => params.has(key))
    const ref = clicked ? { source: clicked[1], medium: 'social', campaign: '' } : fromReferrer()
    if (ref) save(ref)
  }
  // Drop the tags, so a link copied from the address bar doesn't credit the wrong source
  const keys = [...params.keys()].filter((k) => k.startsWith('utm_') || CLICK_IDS.some(([id]) => id === k))
  if (keys.length) {
    keys.forEach((k) => params.delete(k))
    const query = params.toString()
    history.replaceState(history.state, '', `${location.pathname}${query ? `?${query}` : ''}${location.hash}`)
  }
}

export function currentRef(): Ref {
  return read() ?? DIRECT
}

/** True the first time this session the visitor opens this listing */
export function firstVisit(listingId: string): boolean {
  try {
    const seen: string[] = JSON.parse(sessionStorage.getItem(VISITED_KEY) ?? '[]')
    if (seen.includes(listingId)) return false
    sessionStorage.setItem(VISITED_KEY, JSON.stringify([...seen, listingId].slice(-200)))
    return true
  } catch {
    return true
  }
}

/** A listing link that credits `source` on the performance page */
export function shareLink(listingId: string, source: string, medium: string): string {
  const q = new URLSearchParams({ utm_source: source, utm_medium: medium, utm_campaign: 'listing' })
  return `${location.origin}/listing/${encodeURIComponent(listingId)}?${q}`
}
