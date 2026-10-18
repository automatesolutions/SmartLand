import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { FileDown, LinkIcon, Printer } from 'lucide-react'
import { api, ApiError, errorCopy } from '../lib/api'
import type { Report } from '../lib/reports'
import { downloadCsv, printReport } from '../lib/export'
import { formatDate } from '../lib/format'
import { useReveal } from '../lib/motion'
import { Button, ButtonLink } from '../components/Button'
import { EmptyState, Skeleton } from '../components/States'
import { ReportBody, ReportHero } from '../components/ReportBody'

/** Read-only view of a report someone shared with a link */
export function SharedPage() {
  const { token = '' } = useParams()
  const [report, setReport] = useState<Report | null>(null)
  const [failure, setFailure] = useState<unknown>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  useReveal(pageRef, [report?.id])

  useEffect(() => {
    let live = true
    api
      .sharedReport<Report>(token)
      .then((r) => live && setReport(r))
      .catch((err) => live && setFailure(err))
    return () => {
      live = false
    }
  }, [token])

  if (failure) {
    const gone = failure instanceof ApiError && failure.kind === 'not-found'
    const copy = errorCopy(failure)
    return (
      <EmptyState
        as="h1"
        icon={LinkIcon}
        title={gone ? 'This link no longer works' : copy.title}
        body={gone ? 'The person who shared it turned it off, or deleted the report.' : copy.body}
        action={<ButtonLink to="/check">Check a location yourself</ButtonLink>}
      />
    )
  }

  if (!report) {
    return (
      <div aria-busy className="gutter mx-auto flex max-w-reading flex-col gap-md py-section">
        <p role="status" className="sr-only">
          Loading the shared report.
        </p>
        <Skeleton className="h-6 w-1/4" />
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div ref={pageRef}>
      <ReportHero report={report} eyebrow={`Shared report · ${formatDate(report.createdAt)}`} />
      <div className="border-b border-hairline bg-canvas-alt print:hidden">
        <div className="gutter mx-auto flex max-w-reading flex-col gap-lg py-lg">
          <div className="flex flex-col gap-sm xs:flex-row xs:flex-wrap">
            <ButtonLink to="/check" state={{ input: report.input }}>
              Check it with your own values
            </ButtonLink>
            <Button variant="secondary" onClick={printReport} icon={<Printer size={18} aria-hidden />}>
              Print or save as PDF
            </Button>
            <Button variant="secondary" onClick={() => downloadCsv(report)} icon={<FileDown size={18} aria-hidden />}>
              Download CSV
            </Button>
          </div>
        </div>
      </div>
      <ReportBody report={report} />
    </div>
  )
}
