import { ExternalLink, ShieldCheck } from 'lucide-react'

const CHECKS: { title: string; body: string; link?: { href: string; label: string } }[] = [
  {
    title: 'Ask whose name is on the title',
    body: 'If it isn’t the person you’re talking to, ask how they’re connected to the owner. Only PRC-licensed brokers may sell property for someone else (RA 9646), so ask for their license number and look it up.',
    link: { href: 'https://online.prc.gov.ph/Verification', label: 'Look up a PRC license' },
  },
  {
    title: 'See the title before anything else',
    body: 'A seller who won’t show the title is a warning sign. Get a certified true copy from the Registry of Deeds. The owner on it must match the seller’s ID.',
  },
  {
    title: 'Count the people between you and the owner',
    body: 'Each middleman adds a commission to the price. If nobody can put you in touch with the owner or a licensed broker, ask why.',
  },
  {
    title: 'Check the tax declaration',
    body: 'The assessor’s office confirms the tax declaration. The treasurer’s office confirms the real property tax is paid.',
  },
  {
    title: 'Ask a developer for its License to Sell',
    body: 'Subdivision and condo projects need a License to Sell from DHSUD before they can take reservations.',
  },
  {
    title: 'See it before you pay',
    body: 'Visit the property first. Pay only the owner or the developer’s company account, never an agent’s personal account, and get an official receipt.',
  },
]

/** How to deal with the owner instead of a chain of middlemen, before anyone pays */
export function ListingChecks() {
  return (
    <div className="flex flex-col gap-sm">
      <h3 className="inline-flex items-center gap-xs font-semibold text-positive">
        <ShieldCheck size={20} strokeWidth={2} aria-hidden />
        Deal with the owner, not a chain of middlemen
      </h3>
      <ol className="flex flex-col">
        {CHECKS.map((c, i) => (
          <li key={c.title} className="flex items-start gap-sm border-b border-hairline py-sm last:border-b-0">
            <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-pill bg-surface-raised text-caption font-semibold tabular-nums text-ink-secondary">
              {i + 1}
            </span>
            <span className="flex flex-col">
              <span className="font-semibold">{c.title}</span>
              <span className="text-caption text-ink-secondary">{c.body}</span>
              {c.link && (
                <a href={c.link.href} target="_blank" rel="noreferrer" className="press inline-flex min-h-tap items-center gap-xxs self-start text-caption text-accent">
                  {c.link.label}
                  <ExternalLink size={14} aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
