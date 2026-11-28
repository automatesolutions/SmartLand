import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Room, RoomEvent, Track, VideoPresets, type LocalVideoTrack, type Participant, type TrackPublication } from 'livekit-client'
import { CircleX, LoaderCircle, Mic, MicOff, MonitorUp, PhoneOff, SwitchCamera, Users, Video, VideoOff, Volume2 } from 'lucide-react'
import type { CallPass } from '../lib/api'
import { clock } from '../lib/calls'

/** LiveKit's code for "the room was ended" (DeleteRoom), from @livekit/protocol */
const ROOM_DELETED = 5
const WARN_SECONDS = 5 * 60

export type LeaveReason = 'left' | 'ended' | 'time' | 'failed'

export interface CallRoomProps {
  pass: CallPass
  title: string
  /** voice: microphone only. back-camera: microphone and the back camera, for showing a property. */
  start: 'voice' | 'back-camera'
  screenShare: boolean
  onLeave: (reason: LeaveReason) => void
  /** Shown as "End for everyone" when set */
  onEndForAll?: () => Promise<void>
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

function TrackVideo({ pub, mirror, fit }: { pub: TrackPublication; mirror: boolean; fit: 'cover' | 'contain' }) {
  const ref = useRef<HTMLVideoElement>(null)
  const track = pub.track
  useEffect(() => {
    const el = ref.current
    if (!track || !el) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={`absolute inset-0 size-full ${fit === 'cover' ? 'object-cover' : 'object-contain'} ${mirror ? '-scale-x-100' : ''}`}
    />
  )
}

function Tile({ p, facing, big }: { p: Participant; facing: 'user' | 'environment'; big?: boolean }) {
  const cam = p.getTrackPublication(Track.Source.Camera)
  const showCam = cam?.track && !cam.isMuted
  const name = p.name || 'Guest'
  return (
    <figure
      className={`relative flex min-h-40 items-center justify-center overflow-hidden rounded-lg bg-tile ${big ? 'sm:col-span-2' : ''} ${
        p.isSpeaking ? 'ring-2 ring-positive' : 'ring-1 ring-tile-hairline'
      }`}
    >
      {showCam ? (
        <TrackVideo pub={cam} mirror={p.isLocal && facing === 'user'} fit="cover" />
      ) : (
        <span aria-hidden className="flex size-20 items-center justify-center rounded-pill bg-tile-hairline text-display-sm">
          {initials(name)}
        </span>
      )}
      <figcaption className="absolute bottom-xs left-xs inline-flex items-center gap-xxs rounded-pill bg-black/60 px-xs text-caption">
        {!p.isMicrophoneEnabled && <MicOff size={14} aria-label="Microphone off" />}
        {name}
        {p.isLocal && ' (you)'}
      </figcaption>
    </figure>
  )
}

function Control({ label, onClick, active = true, danger, disabled, children }: {
  label: string
  onClick: () => void
  active?: boolean
  danger?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={danger ? undefined : active}
      className="press flex min-w-16 flex-col items-center gap-xxs text-caption disabled:opacity-40"
    >
      <span
        className={`flex size-14 items-center justify-center rounded-pill ${danger ? 'bg-critical' : active ? 'bg-tile ring-1 ring-tile-hairline' : 'bg-on-tile text-black'}`}
      >
        {children}
      </span>
      {label}
    </button>
  )
}

/** A full-screen call: who's in it, their cameras, and the controls. Loaded only when a call opens. */
export default function CallRoom({ pass, title, start, screenShare, onLeave, onEndForAll }: CallRoomProps) {
  // One room per call. Its events redraw the screen through `tick`.
  const [room] = useState(() => new Room({ adaptiveStream: true, dynacast: true, videoCaptureDefaults: { resolution: VideoPresets.h720.resolution } }))
  const audioBox = useRef<HTMLDivElement>(null)
  const leaving = useRef(false)
  const leaveRef = useRef(onLeave)
  const [, setTick] = useState(0)
  const [status, setStatus] = useState<'connecting' | 'live' | 'reconnecting' | 'failed'>('connecting')
  const [problem, setProblem] = useState<string | null>(null)
  const [needsTap, setNeedsTap] = useState(false)
  const [facing, setFacing] = useState<'user' | 'environment'>(start === 'back-camera' ? 'environment' : 'user')
  const [now, setNow] = useState(() => Date.now())
  const [ending, setEnding] = useState(false)

  useEffect(() => {
    leaveRef.current = onLeave
  }, [onLeave])

  useEffect(() => {
    leaving.current = false
    const bump = () => setTick((n) => n + 1)
    const box = audioBox.current
    let cancelled = false

    room
      .on(RoomEvent.ParticipantConnected, bump)
      .on(RoomEvent.ParticipantDisconnected, bump)
      .on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind === Track.Kind.Audio && box) box.appendChild(track.attach())
        bump()
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove())
        bump()
      })
      .on(RoomEvent.TrackMuted, bump)
      .on(RoomEvent.TrackUnmuted, bump)
      .on(RoomEvent.LocalTrackPublished, bump)
      .on(RoomEvent.LocalTrackUnpublished, bump)
      .on(RoomEvent.ActiveSpeakersChanged, bump)
      .on(RoomEvent.AudioPlaybackStatusChanged, () => setNeedsTap(!room.canPlaybackAudio))
      .on(RoomEvent.Reconnecting, () => setStatus('reconnecting'))
      .on(RoomEvent.Reconnected, () => setStatus('live'))
      .on(RoomEvent.Disconnected, (reason) => {
        if (!leaving.current) leaveRef.current(reason === ROOM_DELETED ? 'ended' : 'failed')
      })

    room
      .connect(pass.url, pass.token)
      .then(async () => {
        if (cancelled) return
        setStatus('live')
        try {
          await room.localParticipant.setMicrophoneEnabled(true)
        } catch {
          setProblem('We couldn’t use your microphone, so others can’t hear you. Allow it in your browser’s settings, then turn it on. You can still listen.')
        }
        if (start === 'back-camera') {
          try {
            await room.localParticipant.setCameraEnabled(true, { facingMode: 'environment' })
          } catch {
            setProblem('We couldn’t use your camera. Allow it in your browser’s settings, then turn it on.')
          }
        }
        setNeedsTap(!room.canPlaybackAudio)
        bump()
      })
      .catch(() => {
        if (!cancelled) setStatus('failed')
      })

    return () => {
      cancelled = true
      leaving.current = true
      room.removeAllListeners()
      void room.disconnect()
      box?.replaceChildren()
    }
  }, [room, pass.url, pass.token, start])

  // The countdown, and leaving when the call's time is up
  const ends = new Date(pass.ends_at).getTime()
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const left = Math.max(0, (ends - now) / 1000)
  useEffect(() => {
    if (left > 0 || leaving.current) return
    leaving.current = true
    void room.disconnect()
    leaveRef.current('time')
  }, [left, room])

  const me = status === 'connecting' ? undefined : room.localParticipant
  const everyone: Participant[] = me ? [me, ...room.remoteParticipants.values()] : []
  const sharer = everyone.find((p) => p.getTrackPublication(Track.Source.ScreenShare)?.track)
  const share = sharer?.getTrackPublication(Track.Source.ScreenShare)
  const touch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
  const canShare = screenShare && !touch && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia

  async function toggle(what: 'mic' | 'camera' | 'screen') {
    if (!me) return
    setProblem(null)
    try {
      if (what === 'mic') await me.setMicrophoneEnabled(!me.isMicrophoneEnabled)
      if (what === 'camera') await me.setCameraEnabled(!me.isCameraEnabled, { facingMode: facing })
      if (what === 'screen') await me.setScreenShareEnabled(!me.isScreenShareEnabled)
    } catch {
      setProblem(
        what === 'screen'
          ? 'Screen sharing didn’t start. Pick a window or tab to share, or allow it in your browser’s settings.'
          : `We couldn’t use your ${what === 'mic' ? 'microphone' : 'camera'}. Allow it in your browser’s settings, then try again.`,
      )
    }
    setTick((n) => n + 1)
  }

  async function flip() {
    const next = facing === 'user' ? 'environment' : 'user'
    const track = me?.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined
    try {
      await track?.restartTrack({ facingMode: next })
      setFacing(next)
    } catch {
      setProblem('We couldn’t switch cameras on this phone.')
    }
  }

  async function leave() {
    leaving.current = true
    await room.disconnect()
    onLeave('left')
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-black text-on-tile">
      <div ref={audioBox} hidden />
      <header className="flex items-center gap-sm px-md pt-[max(env(safe-area-inset-top),0.75rem)] pb-sm">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{title}</h2>
          <p className="text-caption text-on-tile-secondary" aria-live="polite">
            {status === 'connecting'
              ? 'Connecting to the call'
              : status === 'reconnecting'
                ? 'Connection lost. Reconnecting.'
                : status === 'failed'
                  ? 'Couldn’t connect'
                  : `${clock(left)} left`}
          </p>
        </div>
        {status === 'live' && (
          <span className="inline-flex items-center gap-xxs text-caption text-on-tile-secondary">
            <Users size={16} aria-hidden />
            {everyone.length}
            <span className="sr-only">{everyone.length === 1 ? 'person' : 'people'} in the call</span>
          </span>
        )}
      </header>

      {left <= WARN_SECONDS && left > 0 && status === 'live' && (
        <p role="status" className="mx-md rounded-sm bg-caution/20 px-sm py-xs text-caption">
          This call ends in {Math.ceil(left / 60)} {Math.ceil(left / 60) === 1 ? 'minute' : 'minutes'}.
        </p>
      )}
      {problem && (
        <p role="alert" className="mx-md mt-xs rounded-sm bg-critical/20 px-sm py-xs text-caption">
          {problem}
        </p>
      )}
      {needsTap && (
        <button
          type="button"
          onClick={() => void room.startAudio().then(() => setNeedsTap(false))}
          className="press mx-md mt-xs inline-flex min-h-tap items-center justify-center gap-xs rounded-pill bg-on-tile px-md text-black"
        >
          <Volume2 size={18} aria-hidden />
          Tap to hear the call
        </button>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto p-md">
        {status === 'failed' ? (
          <div className="flex h-full flex-col items-center justify-center gap-sm text-center">
            <p className="text-tagline">We couldn’t connect to the call</p>
            <p className="max-w-prose text-on-tile-secondary">Check your internet connection, then try again.</p>
          </div>
        ) : status === 'connecting' ? (
          <div className="flex h-full items-center justify-center">
            <LoaderCircle size={32} className="animate-spin" aria-hidden />
          </div>
        ) : (
          <div className="grid auto-rows-[minmax(10rem,1fr)] gap-sm sm:grid-cols-2">
            {share && sharer && (
              <figure className="relative min-h-64 overflow-hidden rounded-lg bg-tile sm:col-span-2">
                <TrackVideo pub={share} mirror={false} fit="contain" />
                <figcaption className="absolute bottom-xs left-xs rounded-pill bg-black/60 px-xs text-caption">
                  {sharer.isLocal ? 'You’re sharing your screen' : `${sharer.name || 'Guest'}’s screen`}
                </figcaption>
              </figure>
            )}
            {everyone.map((p) => (
              <Tile key={p.identity} p={p} facing={facing} big={everyone.length === 1 && !share} />
            ))}
          </div>
        )}
      </main>

      <footer className="flex flex-wrap items-start justify-center gap-md px-md pt-sm pb-[max(env(safe-area-inset-bottom),1rem)]">
        {status !== 'failed' && (
          <>
            <Control label={me?.isMicrophoneEnabled ? 'Mute' : 'Unmute'} active={!!me?.isMicrophoneEnabled} disabled={status !== 'live'} onClick={() => void toggle('mic')}>
              {me?.isMicrophoneEnabled ? <Mic size={22} aria-hidden /> : <MicOff size={22} aria-hidden />}
            </Control>
            <Control label={me?.isCameraEnabled ? 'Stop video' : 'Start video'} active={!!me?.isCameraEnabled} disabled={status !== 'live'} onClick={() => void toggle('camera')}>
              {me?.isCameraEnabled ? <Video size={22} aria-hidden /> : <VideoOff size={22} aria-hidden />}
            </Control>
            {touch && me?.isCameraEnabled && (
              <Control label="Flip" onClick={() => void flip()}>
                <SwitchCamera size={22} aria-hidden />
              </Control>
            )}
            {canShare && (
              <Control label={me?.isScreenShareEnabled ? 'Stop sharing' : 'Share screen'} active={!me?.isScreenShareEnabled} disabled={status !== 'live'} onClick={() => void toggle('screen')}>
                <MonitorUp size={22} aria-hidden />
              </Control>
            )}
          </>
        )}
        <Control label="Leave" danger onClick={() => void leave()}>
          <PhoneOff size={22} aria-hidden />
        </Control>
        {onEndForAll && status === 'live' && (
          <Control
            label={ending ? 'Ending' : 'End for everyone'}
            danger
            disabled={ending}
            onClick={async () => {
              setEnding(true)
              leaving.current = true
              try {
                await onEndForAll()
              } finally {
                await room.disconnect()
                onLeave('ended')
              }
            }}
          >
            <CircleX size={22} aria-hidden />
          </Control>
        )}
      </footer>
    </div>
  )
}
