import { useState } from 'react'
import { FileText, Image, X } from 'lucide-react'
import { workspaceApi, type WsFile } from '../lib/api'
import { fileSize, type Attaching } from '../lib/teamFiles'

/** Files picked for the next message, with upload progress */
export function AttachmentChips({ files, onRemove }: { files: Attaching[]; onRemove: (key: string) => void }) {
  if (files.length === 0) return null
  return (
    <ul aria-label="Attached files" className="flex flex-wrap gap-xs">
      {files.map((f) => (
        <li
          key={f.key}
          className={`inline-flex max-w-full items-center gap-xxs rounded-pill border px-sm py-xxs text-caption ${f.error ? 'border-critical text-critical' : 'border-hairline'}`}
        >
          <FileText size={14} aria-hidden />
          <span className="max-w-48 truncate">{f.name}</span>
          <span className="text-ink-secondary">{f.error ? `· ${f.error}` : f.file ? '' : `· ${Math.round(f.progress * 100)}%`}</span>
          <button
            type="button"
            aria-label={`Remove ${f.name}`}
            onClick={() => onRemove(f.key)}
            className="press -mr-xxs inline-flex size-6 items-center justify-center rounded-pill"
          >
            <X size={14} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** A message's files. Each opens with a fresh link that lasts an hour. */
export function FileList({ orgId, files }: { orgId: string; files: WsFile[] }) {
  const [failed, setFailed] = useState<string | null>(null)

  async function open(f: WsFile) {
    setFailed(null)
    // Opened before waiting, so the browser doesn't block it as a pop-up
    const tab = window.open('', '_blank')
    try {
      const { url } = await workspaceApi.openFile(orgId, f.id)
      if (tab) tab.location.href = url
      else window.location.assign(url)
    } catch {
      tab?.close()
      setFailed(f.id)
    }
  }

  return (
    <ul className="flex flex-col gap-xxs">
      {files.map((f) => (
        <li key={f.id}>
          <button
            type="button"
            onClick={() => void open(f)}
            className="press inline-flex min-h-tap max-w-full items-center gap-xs rounded-sm border border-hairline bg-surface px-sm text-left hover:bg-surface-raised"
          >
            {f.mime.startsWith('image/') ? (
              <Image size={18} className="shrink-0 text-ink-secondary" aria-hidden />
            ) : (
              <FileText size={18} className="shrink-0 text-ink-secondary" aria-hidden />
            )}
            <span className="min-w-0 truncate text-accent">{f.name}</span>
            <span className="shrink-0 text-caption text-ink-secondary">{fileSize(f.size)}</span>
          </button>
          {failed === f.id && (
            <p role="alert" className="text-caption text-critical">
              That file didn’t open. Check your connection, then try again.
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}
