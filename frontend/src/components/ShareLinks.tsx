import { useState } from 'react'
import { Check, Copy, Download, QrCode } from 'lucide-react'
import { SHARE_SOURCES, shareLink } from '../lib/utm'
import { Button } from './Button'

/** Copy-ready links that credit each place you post a listing, and a QR code for flyers */
export function ShareLinks({ listingId, title }: { listingId: string; title: string }) {
  const [copied, setCopied] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // The link to copy by hand when the browser blocks the clipboard
  const [manual, setManual] = useState<{ label: string; url: string } | null>(null)
  const [qr, setQr] = useState<string | null>(null)

  async function copy(source: string, medium: string, label: string) {
    const url = shareLink(listingId, source, medium)
    try {
      await navigator.clipboard.writeText(url)
      setManual(null)
      setCopied(source)
    } catch {
      setCopied(null)
      setManual({ label, url })
    }
  }

  async function showQr() {
    const flyer = SHARE_SOURCES.find((s) => s.source === 'flyer')!
    try {
      // Loaded only when someone asks, so listing pages stay light
      const QRCode = await import('qrcode')
      setQr(await QRCode.toDataURL(shareLink(listingId, flyer.source, flyer.medium), { width: 480, margin: 2 }))
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }

  const file = `smartland-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'listing'}-qr.png`

  return (
    <section aria-labelledby="share-heading" className="flex flex-col gap-sm rounded-lg border border-hairline bg-surface p-md sm:p-lg">
      <h2 id="share-heading" className="text-tagline font-semibold">
        Share links
      </h2>
      <p className="text-caption text-ink-secondary">
        Post the link for each place you share this listing. Performance, under Business, shows which one brings visits and inquiries.
      </p>
      <ul className="flex flex-col">
        {SHARE_SOURCES.filter((s) => s.source !== 'flyer').map((s) => (
          <li key={s.source} className="flex min-h-tap items-center justify-between gap-md border-b border-hairline py-xs">
            <span>{s.label}</span>
            <Button
              variant="plain"
              onClick={() => copy(s.source, s.medium, s.label)}
              icon={copied === s.source ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />}
              aria-label={copied === s.source ? `${s.label} link copied` : `Copy ${s.label} link`}
            >
              {copied === s.source ? 'Copied' : 'Copy link'}
            </Button>
          </li>
        ))}
        <li className="flex min-h-tap items-center justify-between gap-md py-xs">
          <span>Flyer</span>
          {!qr && (
            <Button variant="plain" onClick={showQr} icon={<QrCode size={18} aria-hidden />}>
              Show QR code
            </Button>
          )}
        </li>
      </ul>
      {qr && (
        <div className="flex flex-col items-start gap-sm">
          <img src={qr} alt={`QR code that opens ${title} on SmartLand`} width={240} height={240} className="rounded-md border border-hairline bg-white" />
          <a
            href={qr}
            download={file}
            className="press inline-flex min-h-tap items-center gap-xs rounded-pill border border-accent px-btn-x text-accent"
          >
            <Download size={18} aria-hidden />
            Download QR code
          </a>
        </div>
      )}
      {manual && (
        <label className="flex flex-col gap-xxs">
          <span className="text-caption text-ink-secondary">Your browser didn’t let us copy. Select the {manual.label} link and copy it.</span>
          <input
            readOnly
            value={manual.url}
            onFocus={(e) => e.currentTarget.select()}
            autoFocus
            className="h-tap w-full rounded-sm border border-hairline bg-surface px-sm text-caption text-ink focus-visible:border-focus"
          />
        </label>
      )}
      {failed && (
        <p role="alert" className="text-caption text-critical">
          We couldn’t make the QR code. Try again, or use another browser.
        </p>
      )}
    </section>
  )
}
