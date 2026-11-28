import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Circle, FileVideo, LoaderCircle, Square, Trash2, Video } from 'lucide-react'
import { ApiError, errorCopy, listingsApi, type Listing, type ListingSchema, type ListingVideo } from '../lib/api'
import { Button } from './Button'
import { UploadBar } from './Photos'

/** 95 → "1:35" */
function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Recorder formats, best first. Newer Chrome and Safari record MP4, which plays everywhere.
const RECORD_TYPES = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
// About 15 MB a minute at 720p, so 3 minutes stays well under the limit
const VIDEO_BITS = 2_000_000
const AUDIO_BITS = 64_000

function recordType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return RECORD_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
}

const BY_EXTENSION: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' }

/** Some phones leave the type blank on gallery files, so fall back to the extension */
function withType(file: File): Blob {
  if (file.type) return file
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return file.slice(0, file.size, BY_EXTENSION[ext] ?? '')
}

/** The length of a video file in whole seconds, or null when the browser can't tell */
function readDuration(file: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    const url = URL.createObjectURL(file)
    const done = (value: number | null) => {
      URL.revokeObjectURL(url)
      resolve(value)
    }
    const timer = setTimeout(() => done(null), 5000)
    v.preload = 'metadata'
    v.onloadedmetadata = () => {
      clearTimeout(timer)
      done(Number.isFinite(v.duration) && v.duration > 0 ? Math.ceil(v.duration) : null)
    }
    v.onerror = () => {
      clearTimeout(timer)
      done(null)
    }
    v.src = url
  })
}

type Phase = 'starting' | 'ready' | 'recording' | 'review' | 'failed'

/** Records with the phone's back camera at 720p, up to the time limit */
function Recorder({ maxSeconds, onUse, onCancel }: { maxSeconds: number; onUse: (blob: Blob, seconds: number) => void; onCancel: () => void }) {
  const [phase, setPhase] = useState<Phase>(() => (navigator.mediaDevices ? 'starting' : 'failed'))
  const [elapsed, setElapsed] = useState(0)
  const [take, setTake] = useState<{ blob: Blob; url: string; seconds: number } | null>(null)
  const preview = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    let stopped = false
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop())
        stream.current = s
        if (preview.current) preview.current.srcObject = s
        setPhase('ready')
      })
      .catch(() => !stopped && setPhase('failed'))
    return () => {
      stopped = true
      if (timer.current) clearInterval(timer.current)
      if (recorder.current?.state === 'recording') recorder.current.stop()
      stream.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  useEffect(() => {
    return () => {
      if (take) URL.revokeObjectURL(take.url)
    }
  }, [take])

  function start() {
    const s = stream.current
    const type = recordType()
    if (!s || type === null) return
    const chunks: Blob[] = []
    const rec = new MediaRecorder(s, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: VIDEO_BITS, audioBitsPerSecond: AUDIO_BITS })
    const began = Date.now()
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = () => {
      if (timer.current) clearInterval(timer.current)
      const blob = new Blob(chunks, { type: rec.mimeType || type || 'video/webm' })
      const seconds = Math.min(maxSeconds, Math.max(1, Math.round((Date.now() - began) / 1000)))
      setTake({ blob, url: URL.createObjectURL(blob), seconds })
      setPhase('review')
    }
    recorder.current = rec
    rec.start(1000)
    setElapsed(0)
    setPhase('recording')
    timer.current = window.setInterval(() => {
      const s = (Date.now() - began) / 1000
      setElapsed(s)
      if (s >= maxSeconds && rec.state === 'recording') rec.stop()
    }, 250)
  }

  function again() {
    setTake(null)
    setPhase('ready')
  }

  if (phase === 'failed') {
    return (
      <div className="flex flex-col gap-sm">
        <p role="alert" className="text-caption text-critical">
          We couldn’t open your camera. Allow camera and microphone access for SmartLand in your browser settings, then try again. You can also
          choose a video you already recorded.
        </p>
        <Button variant="plain" className="self-start" onClick={onCancel}>
          Close
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-sm">
      <div className="relative overflow-hidden rounded-lg border border-hairline bg-black">
        {phase === 'review' && take ? (
          <video key={take.url} src={take.url} controls playsInline className="block aspect-video w-full" aria-label="Your recording" />
        ) : (
          <video ref={preview} autoPlay muted playsInline className="block aspect-video w-full object-cover" aria-label="Camera preview" />
        )}
        {phase === 'recording' && (
          <p className="frosted absolute left-xs top-xs inline-flex items-center gap-xxs rounded-pill px-sm py-xxs text-caption tabular-nums text-ink">
            <Circle size={10} className="fill-critical text-critical" aria-hidden />
            {clock(elapsed)} of {clock(maxSeconds)}
          </p>
        )}
      </div>
      <p aria-live="polite" className="sr-only">
        {phase === 'recording' ? 'Recording' : phase === 'review' ? 'Recording stopped. Play it back, then use it or record again.' : ''}
      </p>
      <div className="flex flex-wrap gap-xs">
        {phase === 'starting' && (
          <Button disabled icon={<LoaderCircle size={18} className="animate-spin" aria-hidden />}>
            Opening the camera
          </Button>
        )}
        {phase === 'ready' && (
          <Button onClick={start} icon={<Circle size={18} aria-hidden />}>
            Start recording
          </Button>
        )}
        {phase === 'recording' && (
          <Button onClick={() => recorder.current?.stop()} icon={<Square size={18} aria-hidden />}>
            Stop
          </Button>
        )}
        {phase === 'review' && take && (
          <>
            <Button onClick={() => onUse(take.blob, take.seconds)}>Use this video</Button>
            <Button variant="secondary" onClick={again}>
              Record again
            </Button>
          </>
        )}
        {phase !== 'recording' && (
          <Button variant="plain" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {phase === 'ready' && (
        <p className="text-caption text-ink-secondary">
          Hold your phone sideways. Walk the boundary, then show the road access and what’s next door. Recording stops at {clock(maxSeconds)}.
        </p>
      )}
    </div>
  )
}

/** The listing's videos. The seller's team and SmartLand reviewers can remove them. */
export function VideoList({ listing, onChange }: { listing: Listing; onChange: (videos: ListingVideo[]) => void }) {
  const [confirm, setConfirm] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const list = listing.videos ?? []
  if (list.length === 0) return null

  async function remove(v: ListingVideo) {
    try {
      await listingsApi.deleteVideo(listing.id, v.id)
      onChange(list.filter((x) => x.id !== v.id))
      setConfirm(null)
    } catch {
      setError('We couldn’t remove that video. Try again.')
    }
  }

  return (
    <section aria-label="Videos" className="flex flex-col gap-sm">
      <ul className="flex flex-col gap-sm">
        {list.map((v, n) => (
          <li key={v.id} className="flex flex-col gap-xxs">
            {/* #t=0.1 shows the first frame before play, on phones too */}
            <video
              src={`${v.url}#t=0.1`}
              controls
              playsInline
              preload="metadata"
              className="block aspect-video w-full rounded-lg border border-hairline bg-black"
              aria-label={`Video ${n + 1} of the property`}
            />
            <div className="flex min-h-tap items-center justify-between gap-sm">
              <span className="text-caption tabular-nums text-ink-secondary">
                Video {n + 1}
                {v.duration_s ? ` · ${clock(v.duration_s)}` : ''}
              </span>
              {listing.can_remove_videos &&
                (confirm === v.id ? (
                  <span role="group" aria-label="Confirm remove" className="flex items-center gap-xs">
                    <span className="text-caption">Remove this video for good?</span>
                    <Button variant="plain" className="text-critical" onClick={() => void remove(v)}>
                      Remove
                    </Button>
                    <Button variant="plain" onClick={() => setConfirm(null)}>
                      Keep
                    </Button>
                  </span>
                ) : (
                  <Button variant="plain" onClick={() => setConfirm(v.id)} icon={<Trash2 size={16} aria-hidden />} aria-label={`Remove video ${n + 1}`}>
                    Remove
                  </Button>
                ))}
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-caption text-critical">
          {error}
        </p>
      )}
    </section>
  )
}

/** The seller records or chooses a walkthrough video, which uploads straight to storage */
export function VideoManager({ listing, schema, onAdded }: { listing: Listing; schema: ListingSchema; onAdded: (video: ListingVideo) => void }) {
  const cfg = schema.video
  const [recording, setRecording] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const count = listing.videos?.length ?? 0
  const full = count >= cfg.max_per_listing
  const canRecord = recordType() !== null && !!navigator.mediaDevices

  async function send(blob: Blob, seconds: number | null) {
    setRecording(false)
    setDone(false)
    if (blob.size > cfg.max_mb * 1024 * 1024) {
      setError(`This video is over ${cfg.max_mb} MB. Trim it on your phone, or record it here, which keeps videos small.`)
      return
    }
    if (seconds !== null && seconds > cfg.max_seconds) {
      setError(`This video is ${clock(seconds)} long. Videos can be up to ${clock(cfg.max_seconds)}. Trim it on your phone, then try again.`)
      return
    }
    setError(null)
    setProgress(0)
    try {
      onAdded(await listingsApi.uploadVideo(listing.id, blob, seconds, setProgress))
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError && err.detail ? err.detail : `${errorCopy(err).title}. Try again.`)
    } finally {
      setProgress(null)
    }
  }

  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const blob = withType(f)
    if (!cfg.types.includes(blob.type.split(';')[0])) {
      setError('Choose an MP4, WebM, or MOV video.')
      return
    }
    void send(blob, await readDuration(blob))
  }

  const busy = progress !== null
  const sectionRef = useRef<HTMLElement>(null)

  // The Business page links here with #add-video. The listing loads after the page,
  // so the browser can't scroll to it on its own.
  useEffect(() => {
    if (window.location.hash === '#add-video') sectionRef.current?.scrollIntoView({ block: 'start' })
  }, [])

  return (
    <section ref={sectionRef} id="add-video" aria-labelledby="videos-title" className="flex scroll-mt-[7rem] flex-col gap-md rounded-lg border border-hairline bg-surface p-md sm:p-lg">
      <div className="flex flex-col gap-xxs">
        <h2 id="videos-title" className="text-tagline font-semibold">
          Videos
        </h2>
        <p className="text-caption text-ink-secondary">
          Walk buyers through the property, so they see the land before they call. Anyone can see these videos.
        </p>
      </div>
      {recording ? (
        <Recorder maxSeconds={cfg.max_seconds} onUse={(blob, s) => void send(blob, s)} onCancel={() => setRecording(false)} />
      ) : (
        <>
          <input ref={fileRef} type="file" accept={cfg.types.join(',')} onChange={(e) => void pick(e)} className="sr-only" tabIndex={-1} aria-label="Choose a video" />
          {progress !== null && <UploadBar fraction={progress} label="Uploading video" />}
          <div className="flex flex-wrap gap-xs">
            {canRecord && (
              <Button variant="secondary" disabled={full || busy} onClick={() => setRecording(true)} icon={<Video size={18} aria-hidden />}>
                Record a video
              </Button>
            )}
            <Button
              variant={canRecord ? 'plain' : 'secondary'}
              disabled={full || busy}
              onClick={() => fileRef.current?.click()}
              icon={busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : <FileVideo size={18} aria-hidden />}
            >
              {busy ? 'Uploading' : 'Choose a video'}
            </Button>
          </div>
        </>
      )}
      <p className="text-caption text-ink-secondary">
        {full
          ? `${cfg.max_per_listing} videos added. Remove one to add another.`
          : `Up to ${cfg.max_per_listing} videos, ${cfg.max_seconds / 60} minutes and ${cfg.max_mb} MB each.`}
        {listing.video_space_left_mb !== undefined && ` You have ${listing.video_space_left_mb.toLocaleString('en-US')} MB of video space left.`}
      </p>
      <p aria-live="polite" className="text-caption text-ink-secondary empty:hidden">
        {done ? 'Your video is on the listing.' : ''}
      </p>
      {error && (
        <p role="alert" className="text-caption text-critical">
          {error}
        </p>
      )}
    </section>
  )
}
