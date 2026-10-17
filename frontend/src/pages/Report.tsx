import { useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowRight,
  BookmarkCheck,
  BookmarkPlus,
  ChevronLeft,
  Copy,
  FileDown,
  FileQuestion,
  Link2,
  Link2Off,
  Pencil,
  Printer,
  Trash2,
} from 'lucide-react'
import { deleteReport, findReport, saveReport, setShared, useSavedReports, type Report } from '../lib/reports'
import { useUser } from '../lib/auth'
import { downloadCsv, printReport } from '../lib/export'
import { formatDate, parseGrade } from '../lib/format'
import { useReveal } from '../lib/motion'
import { Button, ButtonLink } from '../components/Button'
import { GradeBadge } from '../components/Grade'
import { Banner, EmptyState } from '../components/States'
import { ReportBody } from '../components/ReportBody'

type Notice = 'saved-device' | 'saved-account' | 'save-failed' | 'share-failed' | 'delete-failed' | 'copied' | null

function shareUrl(token: string) {
  return `${window.location.origin}/shared/${token}`
}

function SharePanel({ report, onNotice }: { report: Report; onNotice: (n: Notice) => void }) {
  const [busy, setBusy] = useState(false)
  const token = report.shareToken

  async function toggle(on: boolean) {
    setBusy(true)
    try {
      await setShared(report, on)
    } catch {
      onNotice('share-failed')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(shareUrl(token!))
      onNotice('copied')
    } catch {
      // Clipboard blocked: the link is selectable in the field
      document.getElementById('share-link')?.focus()
    }
  }

  if (!token) {
    return (
      <Button variant="secondary" disabled={busy} onClick={() => void toggle(true)} icon={<Link2 size={18} aria-hidden />}>
        Create share link
      </Button>
    )
  }
  return (
    <div className="flex w-full flex-col gap-xs rounded-lg border border-hairline bg-surface p-md">
      <label htmlFor="share-link" className="font-semibold">
        Share link
      </label>
      <p className="text-caption text-ink-secondary">Anyone with this link can view the report. They can't change it.</p>
      <input
        id="share-link"
        readOnly
        value={shareUrl(token)}
        onFocus={(e) => e.currentTarget.select()}
        className="h-tap w-full rounded-sm border border-hairline bg-surface-raised px-sm text-caption text-ink"
      />
      <div className="flex flex-wrap gap-sm">
        <Button onClick={() => void copy()} icon={<Copy size={18} aria-hidden />}>
          Copy link
        </Button>
        <Button variant="plain" disabled={busy} onClick={() => void toggle(false)} icon={<Link2Off size={18} aria-hidden />}>
          Turn off link
        </Button>
      </div>
    </div>
  )
}

export function ReportPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const fresh = (useLocation().state as { fresh?: boolean } | null)?.fresh ?? false
  const user = useUser()
  // Subscribing re-renders this page when the saved list changes, so the
  // lookup below always reflects whether the report is saved
  useSavedReports()
  const found = findReport(id)
  const [notice, setNotice] = useState<Notice>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const pageRef = useRef<HTMLDivElement>(null)
  useReveal(pageRef, [id])

  if (!found) {
    return (
      <EmptyState
        as="h1"
        icon={FileQuestion}
        title="We can't find this report"
        body={
          user
            ? 'It may have been deleted, or it was never saved.'
            : 'It may have been deleted, or it was saved in a different browser. Sign in to see reports saved to your account.'
        }
        action={<ButtonLink to={user ? '/check' : '/account'}>{user ? 'Check a location' : 'Sign in'}</ButtonLink>}
      />
    )
  }

  const { report, saved } = found
  const { result, input } = report
  const grade = parseGrade(result.category)

  async function onSave() {
    setSaving(true)
    const where = await saveReport(report)
    setSaving(false)
    setNotice(where === 'account' ? 'saved-account' : where === 'device' ? 'saved-device' : 'save-failed')
  }

  async function onDelete() {
    if (await deleteReport(report.id)) navigate('/reports', { state: { deleted: result.location } })
    else setNotice('delete-failed')
  }

  return (
    <div ref={pageRef}>
      {/* Header band */}
      <div className="bg-canvas-alt">
        <div className="gutter mx-auto flex max-w-reading flex-col gap-lg pb-xxl pt-lg sm:pb-section">
          <Link
            to={saved ? '/reports' : '/check'}
            state={saved ? undefined : { input }}
            className="press -ml-xs inline-flex min-h-tap items-center gap-xxs self-start px-xs text-accent print:hidden"
          >
            <ChevronLeft size={20} aria-hidden />
            {saved ? 'Saved reports' : 'Back to the form'}
          </Link>

          <div data-reveal className="flex flex-col gap-sm">
            <p className="text-caption text-ink-secondary">Report · {formatDate(report.createdAt)}</p>
            <h1 className="text-display-md sm:text-display-lg">{result.location}</h1>
            <div>
              <GradeBadge grade={grade} size="large" />
            </div>
          </div>

          {notice === 'saved-account' && (
            <Banner
              tone="positive"
              title="Report saved"
              onDismiss={() => setNotice(null)}
              action={
                <ButtonLink to="/reports" variant="plain" className="-ml-xs" iconAfter={<ArrowRight size={18} aria-hidden />}>
                  Open saved reports
                </ButtonLink>
              }
            >
              It's in your account, so you can open it on any device where you sign in.
            </Banner>
          )}
          {notice === 'saved-device' && (
            <Banner
              tone="positive"
              title="Report saved on this device"
              onDismiss={() => setNotice(null)}
              action={
                <ButtonLink to="/account" variant="plain" className="-ml-xs" iconAfter={<ArrowRight size={18} aria-hidden />}>
                  {user ? 'Check your account' : 'Sign in to keep it everywhere'}
                </ButtonLink>
              }
            >
              {user
                ? "We couldn't reach your account. We'll upload it the next time you're online."
                : 'Sign in to keep reports on every device and share them with a link.'}
            </Banner>
          )}
          {notice === 'save-failed' && (
            <Banner tone="critical" title="We couldn't save this report" onDismiss={() => setNotice(null)}>
              Your browser is blocking site storage. Allow storage for this site, then try again.
            </Banner>
          )}
          {notice === 'share-failed' && (
            <Banner tone="critical" title="We couldn't change the share link" onDismiss={() => setNotice(null)}>
              Check your connection, then try again.
            </Banner>
          )}
          {notice === 'delete-failed' && (
            <Banner tone="critical" title="We couldn't delete this report" onDismiss={() => setNotice(null)}>
              Check your connection, then try again.
            </Banner>
          )}
          {notice === 'copied' && (
            <p role="status" className="text-caption text-positive">
              Link copied.
            </p>
          )}
          {fresh && !saved && notice === null && (
            <p role="status" className="sr-only">
              Report ready for {result.location}.
            </p>
          )}

          <div data-reveal className="flex flex-col gap-sm xs:flex-row xs:flex-wrap print:hidden">
            {saved ? (
              <Button variant="secondary" icon={<BookmarkCheck size={20} aria-hidden />} disabled>
                Saved
              </Button>
            ) : (
              <Button onClick={() => void onSave()} disabled={saving} icon={<BookmarkPlus size={20} aria-hidden />}>
                Save report
              </Button>
            )}
            <ButtonLink to="/check" state={{ input }} variant="secondary" icon={<Pencil size={18} aria-hidden />}>
              Change values
            </ButtonLink>
            <Button variant="secondary" onClick={printReport} icon={<Printer size={18} aria-hidden />}>
              Print or save as PDF
            </Button>
            <Button variant="secondary" onClick={() => downloadCsv(report)} icon={<FileDown size={18} aria-hidden />}>
              Download CSV
            </Button>
          </div>

          <div className="print:hidden">
            {user && saved ? (
              <SharePanel report={report} onNotice={setNotice} />
            ) : (
              <p className="text-caption text-ink-secondary">
                {user ? (
                  'Save this report to share it with a link.'
                ) : (
                  <>
                    <Link to="/account" className="text-accent">
                      Sign in
                    </Link>{' '}
                    to share reports with a link and keep them on every device.
                  </>
                )}
              </p>
            )}
          </div>
        </div>
      </div>

      <ReportBody report={report} />

      <div className="gutter mx-auto max-w-reading pb-xxl sm:pb-section print:hidden">
        <div data-reveal className="flex flex-col gap-md border-t border-hairline pt-lg sm:flex-row sm:items-center sm:justify-between">
          <ButtonLink to="/check" variant="plain" iconAfter={<ArrowRight size={18} aria-hidden />} className="self-start">
            Check another location
          </ButtonLink>
          {saved &&
            (confirmDelete ? (
              <div role="group" aria-label="Confirm delete" className="flex flex-wrap items-center gap-sm">
                <span className="text-caption">Delete this report?</span>
                <Button variant="plain" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
                <Button variant="secondary" className="border-critical text-critical" onClick={() => void onDelete()}>
                  Delete
                </Button>
              </div>
            ) : (
              <Button
                variant="plain"
                className="self-start text-critical"
                icon={<Trash2 size={18} aria-hidden />}
                onClick={() => setConfirmDelete(true)}
              >
                Delete report
              </Button>
            ))}
        </div>
      </div>
    </div>
  )
}
