import { useRef, useState, type ChangeEvent } from 'react'
import { ChevronLeft, ChevronRight, ImagePlus, LoaderCircle, Trash2 } from 'lucide-react'
import { ApiError, errorCopy, listingsApi, type Listing, type ListingPhoto, type ListingSchema } from '../lib/api'
import { Button } from './Button'

/** A thin progress bar for an upload, with its percentage for screen readers */
export function UploadBar({ fraction, label }: { fraction: number; label: string }) {
  const pct = Math.round(fraction * 100)
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-1 w-full overflow-hidden rounded-pill bg-surface-raised">
      <div className="h-full bg-accent-fill transition-[width] duration-200 ease-apple" style={{ width: `${pct}%` }} />
    </div>
  )
}

/** The listing's photos: one large, with buttons and thumbnails to move between them */
export function PhotoGallery({ photos }: { photos: ListingPhoto[] }) {
  const [index, setIndex] = useState(0)
  if (photos.length === 0) return null
  const i = Math.min(index, photos.length - 1)
  const photo = photos[i]
  const step = (d: number) => setIndex((i + d + photos.length) % photos.length)

  return (
    <section aria-label="Photos" className="flex flex-col gap-xs">
      <div className="relative overflow-hidden rounded-lg border border-hairline bg-surface-raised">
        <img src={photo.url} alt={photo.alt} className="block aspect-[4/3] w-full object-cover" />
        {photos.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous photo"
              className="press frosted absolute left-xs top-1/2 inline-flex size-tap -translate-y-1/2 items-center justify-center rounded-pill text-ink"
            >
              <ChevronLeft size={20} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next photo"
              className="press frosted absolute right-xs top-1/2 inline-flex size-tap -translate-y-1/2 items-center justify-center rounded-pill text-ink"
            >
              <ChevronRight size={20} aria-hidden />
            </button>
          </>
        )}
      </div>
      {photos.length > 1 && (
        <div className="flex items-center justify-between gap-sm">
          <ul className="flex gap-xs overflow-x-auto">
            {photos.map((p, n) => (
              <li key={p.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setIndex(n)}
                  aria-label={`Photo ${n + 1}: ${p.alt}`}
                  aria-current={n === i}
                  className={`press block overflow-hidden rounded-sm ${n === i ? 'border-2 border-focus' : 'border border-hairline'}`}
                >
                  <img src={p.url} alt="" loading="lazy" className="block size-tap object-cover" />
                </button>
              </li>
            ))}
          </ul>
          <p aria-live="polite" className="shrink-0 text-caption tabular-nums text-ink-secondary">
            {i + 1} of {photos.length}
          </p>
        </div>
      )}
    </section>
  )
}

/** The seller adds or removes photos on their own listing */
export function PhotoManager({ listing, schema, onChange }: { listing: Listing; schema: ListingSchema; onChange: (photos: ListingPhoto[]) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [alt, setAlt] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const photos = listing.photos
  const full = photos.length >= schema.max_photos

  function pick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (f.size > schema.max_photo_mb * 1024 * 1024) {
      setError(`This photo is too large. Photos can be up to ${schema.max_photo_mb} MB.`)
      return
    }
    setError(null)
    setFile(f)
  }

  async function send() {
    if (!file) return
    if (alt.trim().length < 3) {
      setError('Describe the photo in a few words, such as “Front of the lot from the road”.')
      return
    }
    setError(null)
    setProgress(0)
    try {
      const photo = await listingsApi.uploadPhoto(listing.id, file, alt.trim(), setProgress)
      onChange([...photos, photo])
      setFile(null)
      setAlt('')
    } catch (err) {
      setError(err instanceof ApiError && err.detail ? err.detail : `${errorCopy(err).title}. Try again.`)
    } finally {
      setProgress(null)
    }
  }

  async function remove(photo: ListingPhoto) {
    try {
      await listingsApi.deletePhoto(listing.id, photo.id)
      onChange(photos.filter((p) => p.id !== photo.id))
    } catch {
      setError('We couldn’t remove that photo. Try again.')
    }
  }

  return (
    <section aria-labelledby="photos-title" className="flex flex-col gap-md rounded-lg border border-hairline bg-surface p-md sm:p-lg">
      <div className="flex flex-col gap-xxs">
        <h2 id="photos-title" className="text-tagline font-semibold">
          Photos
        </h2>
        <p className="text-caption text-ink-secondary">
          Anyone can see these. Don’t upload the title or other documents here. Add those under Documents, where they stay private.
        </p>
      </div>
      {photos.length > 0 && (
        <ul className="grid grid-cols-3 gap-xs sm:grid-cols-4">
          {photos.map((p) => (
            <li key={p.id} className="relative">
              <img src={p.url} alt={p.alt} loading="lazy" className="block aspect-square w-full rounded-sm border border-hairline object-cover" />
              <button
                type="button"
                onClick={() => void remove(p)}
                aria-label={`Remove photo: ${p.alt}`}
                className="press frosted absolute right-xxs top-xxs inline-flex size-tap items-center justify-center rounded-pill text-critical"
              >
                <Trash2 size={16} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input ref={fileRef} type="file" accept={schema.photo_types.join(',')} onChange={pick} className="sr-only" tabIndex={-1} aria-label="Choose a photo" />
      {file ? (
        <div className="flex flex-col gap-xs">
          <label htmlFor="photo-alt" className="font-semibold">
            Describe {file.name}
          </label>
          <input
            id="photo-alt"
            value={alt}
            maxLength={200}
            onChange={(e) => setAlt(e.target.value)}
            placeholder="Front of the lot from the road"
            className="h-tap w-full rounded-sm border border-hairline bg-surface px-md text-ink focus-visible:border-focus"
          />
          {progress !== null && <UploadBar fraction={progress} label={`Uploading ${file.name}`} />}
          <div className="flex flex-wrap gap-xs">
            <Button
              disabled={progress !== null}
              onClick={() => void send()}
              icon={progress !== null ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : undefined}
            >
              {progress !== null ? 'Uploading' : 'Upload photo'}
            </Button>
            <Button variant="plain" disabled={progress !== null} onClick={() => setFile(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" className="self-start" disabled={full} onClick={() => fileRef.current?.click()} icon={<ImagePlus size={18} aria-hidden />}>
          {full ? `${schema.max_photos} photos added` : 'Add a photo'}
        </Button>
      )}
      <p className="text-caption text-ink-secondary">
        JPG, PNG, or WebP, up to {schema.max_photo_mb} MB each, {schema.max_photos} photos at most. The first photo is the cover.
      </p>
      {error && (
        <p role="alert" className="text-caption text-critical">
          {error}
        </p>
      )}
    </section>
  )
}
