import { useEffect, useState } from 'react'
import { ApiError, workspaceApi, type WsFile } from './api'

export const MAX_FILES = 5
export const MAX_FILE_MB = 20

// What phones sometimes leave blank, by extension. Matches backend/team_files.py.
const EXT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  txt: 'text/plain',
  csv: 'text/csv',
}

export const ACCEPT = Object.keys(EXT_TYPES)
  .map((e) => `.${e}`)
  .join(',')

export const fileType = (f: File) => f.type || EXT_TYPES[f.name.split('.').pop()?.toLowerCase() ?? ''] || 'application/octet-stream'

export const fileSize = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

export interface Attaching {
  key: string
  name: string
  progress: number
  file?: WsFile
  error?: string
}

export type AttachFn = (file: File, mime: string, onProgress: (fraction: number) => void) => Promise<WsFile>

/** Files being attached to a message: each uploads as soon as it's picked */
export function useAttachments(attach: AttachFn | undefined) {
  const [files, setFiles] = useState<Attaching[]>([])

  function add(list: FileList | null): string | null {
    if (!list || !attach) return null
    const room = MAX_FILES - files.length
    for (const f of [...list].slice(0, Math.max(0, room))) {
      const key = `${f.name}-${f.size}-${Math.random()}`
      const patch = (p: Partial<Attaching>) => setFiles((all) => all.map((a) => (a.key === key ? { ...a, ...p } : a)))
      if (f.size > MAX_FILE_MB * 1024 * 1024) {
        setFiles((all) => [...all, { key, name: f.name, progress: 0, error: `Over ${MAX_FILE_MB} MB` }])
        continue
      }
      setFiles((all) => [...all, { key, name: f.name, progress: 0 }])
      attach(f, fileType(f), (p) => patch({ progress: p }))
        .then((file) => patch({ file, progress: 1 }))
        .catch((err) => patch({ error: err instanceof ApiError && err.detail ? err.detail : 'Didn’t upload. Remove it and try again.' }))
    }
    return list.length > room ? `You can attach up to ${MAX_FILES} files to a message.` : null
  }

  return {
    files,
    add,
    remove: (key: string) => setFiles((all) => all.filter((a) => a.key !== key)),
    clear: () => setFiles([]),
    uploading: files.some((f) => !f.file && !f.error),
    ready: files.filter((f) => f.file).map((f) => f.file!.id),
  }
}

// Asked once per page load: whether file storage is on
let cached: Promise<boolean> | null = null

export function useFilesOn(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let live = true
    cached ??= workspaceApi.filesConfig().then(
      (c) => c.enabled,
      () => {
        cached = null
        return false
      },
    )
    void cached.then((v) => live && setOn(v))
    return () => {
      live = false
    }
  }, [])
  return on
}
