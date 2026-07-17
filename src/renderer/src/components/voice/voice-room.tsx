import '@livekit/components-styles'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAction } from 'convex/react'
import {
  LayoutContextProvider,
  isTrackReference,
  useConnectionState,
  useCreateLayoutContext,
  useMediaDeviceSelect,
  usePinnedTracks,
  useTracks
} from '@livekit/components-react'
import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'
import { ConnectionState, Track } from 'livekit-client'
import {
  ArrowsIn,
  ArrowsOut,
  CaretDown,
  CaretUp,
  Check,
  Microphone,
  MicrophoneSlash,
  Monitor,
  PhoneDisconnect,
  PushPin,
  SpeakerHigh,
  UsersThree,
  VideoCamera,
  VideoCameraSlash
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { api } from '@convex/_generated/api'
import type { Doc } from '@convex/_generated/dataModel'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/spinner'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { Tip } from '@renderer/components/ui/tooltip'
import { useVoiceStore } from '@renderer/store/voice-store'
import { useSettingsStore } from '@renderer/store/settings-store'
import { useCallControls } from '@renderer/components/voice/use-call-controls'
import { ScreenSharePicker } from '@renderer/components/voice/screen-share-picker'
import { DeafenGlyph } from '@renderer/components/voice/deafen-glyph'
import { VoiceTile } from '@renderer/components/voice/voice-tile'
import { TileGrid } from '@renderer/components/voice/tile-grid'
import { errorMessage } from '@renderer/lib/convex-error'
import { platform } from '@renderer/lib/platform'
import { sameTrack } from '@renderer/lib/track-ref'
import { cn } from '@renderer/lib/utils'

// Public, non-secret: the LiveKit server the renderer connects to (the minted
// token is the capability). Absent → voice isn't set up (see .env.sample).
const SERVER_URL = import.meta.env.VITE_LIVEKIT_URL as string | undefined

/** A `voice` channel — a Discord-style call room on a self-hosted LiveKit SFU.
 *  Opening the channel **auto-joins** (like Discord clicking a voice channel); the
 *  room itself lives at the app shell (`voice-call-provider.tsx`) so the call
 *  persists across navigation and the user bar can drive it. This view just renders
 *  the tiles + the in-call control bar. */
export function RealVoiceView({
  channel,
  serverSlug
}: {
  channel: Doc<'channels'>
  serverSlug: string
}): React.JSX.Element {
  const getToken = useAction(api.voice.getToken)
  const call = useVoiceStore((state) => state.call)
  const connecting = useVoiceStore((state) => state.connecting)
  const setConnecting = useVoiceStore((state) => state.setConnecting)
  const joinCall = useVoiceStore((state) => state.join)
  const isActive = call?.channelId === channel._id

  const join = useCallback(async () => {
    setConnecting(channel._id)
    try {
      const { token } = await getToken({ channelId: channel._id })
      joinCall({
        channelId: channel._id,
        channelName: channel.name,
        workspaceSlug: serverSlug,
        token
      })
    } catch (error) {
      setConnecting(null)
      toast.error(errorMessage(error, 'Could not join the call'))
    }
  }, [getToken, channel._id, channel.name, serverSlug, setConnecting, joinCall])

  // Auto-join on opening a voice channel you're not already in. Keyed to the
  // channel only, so LEAVING (which nulls `call`) never triggers a rejoin.
  useEffect(() => {
    if (useVoiceStore.getState().call?.channelId === channel._id) return
    void join()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel._id])

  if (!SERVER_URL) {
    return (
      <Centered>
        <SpeakerHigh className="size-8 opacity-40" weight="duotone" />
        <p className="text-sm">Voice calling isn’t set up on this server yet.</p>
      </Centered>
    )
  }

  if (isActive) {
    return <ActiveCall />
  }

  // You left this call (or it's mid-connect) — a playful, themed "waiting room" that
  // offers to (re)join, with a drifting gradient atmosphere behind it (Discord-style).
  const isConnecting = connecting === channel._id
  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden">
      <VoiceAtmosphere />
      <div className="relative z-10 flex flex-col items-center gap-5 p-6 text-center">
        <div className="relative flex size-24 items-center justify-center">
          {/* A soft breathing halo behind the glyph — the room feels "alive" while empty. */}
          <span className="absolute inset-0 animate-pulse rounded-full bg-primary/25 blur-xl" />
          <span className="relative flex size-20 items-center justify-center rounded-3xl border border-primary/20 bg-primary/10 text-primary shadow-lg shadow-primary/10">
            <SpeakerHigh className="size-9" weight="duotone" />
          </span>
        </div>
        <div className="space-y-1.5">
          <p className="text-2xl font-bold tracking-tight text-foreground">{channel.name}</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            {isConnecting
              ? 'Connecting to voice…'
              : 'Hop in to talk, video chat and share your screen.'}
          </p>
        </div>
        <Button
          size="lg"
          className="gap-2 shadow-lg shadow-primary/20"
          disabled={isConnecting}
          onClick={() => void join()}
        >
          {isConnecting ? (
            <Spinner className="size-4" />
          ) : (
            <Microphone className="size-4" weight="fill" />
          )}
          {isConnecting ? 'Connecting…' : 'Join Voice'}
        </Button>
      </div>
    </div>
  )
}

/** The drifting, themed gradient background behind the voice pre-join screen — Discord's
 *  playful animated voice look, in our palette. Decorative (`aria-hidden`); the blobs are
 *  primary-tinted so it stays on-theme, and `prefers-reduced-motion` freezes them (see the
 *  `voice-blob` rule in globals.css). */
function VoiceAtmosphere(): React.JSX.Element {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.06] via-transparent to-primary/[0.12]" />
      <div className="voice-blob absolute -top-24 -left-40 size-[38rem] rounded-full bg-primary/25 blur-[120px] [animation:voice-drift-a_26s_ease-in-out_infinite]" />
      <div className="voice-blob absolute -right-32 -bottom-32 size-[34rem] rounded-full bg-primary/15 blur-[130px] [animation:voice-drift-b_34s_ease-in-out_infinite]" />
      <div className="voice-blob absolute top-1/2 left-1/2 size-[26rem] rounded-full bg-primary/10 blur-[110px] [animation:voice-drift-c_22s_ease-in-out_infinite]" />
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center text-muted-foreground">
      {children}
    </div>
  )
}

/** The live call: the stage (tiles / spotlight) + the control bar, wrapped in the
 *  element we fullscreen — so **fullscreen covers the whole display INCLUDING the
 *  controls** (Discord), hiding the app sidebar/header entirely, not just enlarging
 *  the tiles. HTML fullscreen (stretches this element over the viewport) is PAIRED
 *  with native window fullscreen (`platform.setWindowFullScreen` → Electron
 *  `BrowserWindow.setFullScreen`) so the pair is a true whole-display experience —
 *  no title bar, no taskbar. (Main must also allow the `fullscreen` permission —
 *  see `configureMediaPermissions`; denied, `requestFullscreen` is a silent no-op.) */
function ActiveCall(): React.JSX.Element {
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Sync fullscreen state: native window events on desktop (also catches F11 / the
  // menu), the DOM fullscreen event on web.
  useEffect(() => {
    if (platform.isElectron) {
      return platform.onWindowFullScreenChange(setIsFullscreen)
    }
    const onChange = (): void => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Never strand fullscreen when leaving the call view (navigate away / leave call).
  useEffect(() => {
    return () => {
      void platform.setWindowFullScreen(false)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [])

  const toggleFullscreen = useCallback((): void => {
    const currentlyFullscreen = platform.isElectron
      ? isFullscreen
      : Boolean(document.fullscreenElement)
    if (currentlyFullscreen) {
      if (platform.isElectron) void platform.setWindowFullScreen(false)
      else if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    } else if (platform.isElectron) {
      // Native OS-window fullscreen: title bar + taskbar gone (YouTube/Discord-style).
      void platform.setWindowFullScreen(true)
    } else {
      // Web: fullscreen the whole page; the fixed overlay below then fills it.
      void document.documentElement.requestFullscreen().catch(() => {
        toast.error('Could not enter fullscreen')
      })
    }
  }, [isFullscreen])

  // In fullscreen, auto-hide the controls (+ cursor) after idle — like YouTube/Discord.
  const uiVisible = useAutoHideInFullscreen(isFullscreen)

  // ONE div, class-toggled — never restructured — so `VoiceStage` (which owns the
  // focus/pin state) is not remounted when toggling fullscreen. In fullscreen it
  // becomes a `fixed inset-0` overlay filling the now-fullscreen window/page, ON TOP
  // of the app sidebar/header (no transform ancestors trap it — verified).
  return (
    <div
      className={cn(
        'flex flex-col',
        isFullscreen ? 'fixed inset-0 z-[100] bg-black' : 'relative min-h-0 flex-1 bg-background',
        isFullscreen && !uiVisible && 'cursor-none'
      )}
    >
      <VoiceStage isFullscreen={isFullscreen} uiVisible={uiVisible} />
      <VoiceControlBar
        isFullscreen={isFullscreen}
        uiVisible={uiVisible}
        onToggleFullscreen={toggleFullscreen}
      />
    </div>
  )
}

/** In fullscreen, hide the call UI after 3s of no input, reveal on any input.
 *  Covers mouse, keyboard, wheel AND touch/pen (tablets/touchscreens) via pointer +
 *  touch events. Always visible when not fullscreen. (State is only ever set from
 *  timers / event handlers, never synchronously in the effect.) */
function useAutoHideInFullscreen(active: boolean): boolean {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    if (!active) {
      // Leaving fullscreen resets to visible (async so it's not a sync effect set).
      const reset = window.setTimeout(() => setHidden(false), 0)
      return () => window.clearTimeout(reset)
    }
    let timer = 0
    const armIdle = (): void => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setHidden(true), 3000)
    }
    const reveal = (): void => {
      setHidden(false)
      armIdle()
    }
    // Reveal on any human input; `touchstart`/`pointerdown` cover tablets & touchscreens.
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart']
    events.forEach((event) => window.addEventListener(event, reveal, { passive: true }))
    armIdle() // arm the idle timer without touching state synchronously
    return () => {
      window.clearTimeout(timer)
      events.forEach((event) => window.removeEventListener(event, reveal))
    }
  }, [active])
  return active ? !hidden : true
}

/** The stage — Discord's spotlight/focus layout. A grid by default; focusing a tile
 *  (auto for a new screen share, click a tile, or its hover expand button) makes it
 *  the big view with everyone else in a **bottom filmstrip**, toggled by Discord's
 *  **Show/Hide Members pill** — a chevron+people button centered on the boundary
 *  (bottom of the focused view when hidden, riding the strip's top edge when shown,
 *  revealed on hover). Click a strip tile to swap the spotlight; the focused tile's
 *  hover button returns to the grid. The layout is identical in fullscreen (strip +
 *  controls stay), just edge-to-edge on black. */
function VoiceStage({
  isFullscreen,
  uiVisible
}: {
  isFullscreen: boolean
  uiVisible: boolean
}): React.JSX.Element {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false }
    ],
    { onlySubscribed: false }
  )
  const layoutContext = useCreateLayoutContext()
  const focusTrack = usePinnedTracks(layoutContext)?.[0]
  const otherTracks = focusTrack ? tracks.filter((t) => !sameTrack(t, focusTrack)) : tracks
  const screenShareTracks = tracks
    .filter(isTrackReference)
    .filter((t) => t.publication.source === Track.Source.ScreenShare)
  const autoFocused = useRef<TrackReferenceOrPlaceholder | null>(null)
  // Discord defaults to showing the member strip when something takes focus.
  const [stripOpen, setStripOpen] = useState(true)

  // Auto-focus a screen share when one starts (incl. your OWN — a local track has a
  // publication with a live `track`), release it when it stops. Mirrors LiveKit's
  // VideoConference. `autoFocused` stays set after a manual unfocus so the effect
  // doesn't immediately re-pin the same share.
  useEffect(() => {
    const dispatch = layoutContext.pin.dispatch
    const active = autoFocused.current
    const live = screenShareTracks.filter((t) => t.publication?.track && !t.publication.isMuted)
    if (live.length > 0 && active === null) {
      autoFocused.current = live[0]
      dispatch?.({ msg: 'set_pin', trackReference: live[0] })
    } else if (active && !live.some((t) => sameTrack(t, active))) {
      autoFocused.current = null
      dispatch?.({ msg: 'clear_pin' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenShareTracks])

  const showStrip = Boolean(focusTrack) && stripOpen && otherTracks.length > 0
  const membersPill = (
    <Tip label={stripOpen ? 'Hide Members' : 'Show Members'}>
      <button
        type="button"
        onClick={() => setStripOpen((open) => !open)}
        aria-label={stripOpen ? 'Hide Members' : 'Show Members'}
        className={cn(
          'pointer-events-auto flex items-center gap-1.5 rounded-lg bg-black/70 px-2.5 py-1.5 text-white/90 backdrop-blur transition-opacity hover:bg-black/85 focus-visible:opacity-100',
          // Fullscreen: follow the auto-hide timer. Windowed: reveal on stage hover.
          isFullscreen
            ? uiVisible
              ? 'opacity-100'
              : 'pointer-events-none opacity-0'
            : 'opacity-0 group-hover/stage:opacity-100'
        )}
      >
        {stripOpen ? (
          <CaretDown className="size-3.5" weight="bold" />
        ) : (
          <CaretUp className="size-3.5" weight="bold" />
        )}
        <UsersThree className="size-4" weight="fill" />
      </button>
    </Tip>
  )

  return (
    <div className="group/stage relative flex min-h-0 flex-1 flex-col">
      <ConnectionStatus />
      <LayoutContextProvider value={layoutContext}>
        {focusTrack ? (
          <>
            {/* Spotlight: the focused tile fills; the pill floats bottom-center of
                it while the strip is hidden. */}
            <div className={cn('relative min-h-0 flex-1', isFullscreen ? 'p-0' : 'p-3')}>
              <div
                className={cn('h-full w-full overflow-hidden', isFullscreen ? '' : 'rounded-xl')}
              >
                <VoiceTile trackRef={focusTrack} flush={isFullscreen} />
              </div>
              {!showStrip ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
                  {otherTracks.length > 0 ? membersPill : null}
                </div>
              ) : null}
            </div>

            {/* Discord's bottom filmstrip — everyone not in focus, horizontally
                scrollable, centered when few. Click a tile to swap the spotlight.
                The pill rides its top edge. */}
            {showStrip ? (
              <div className="relative h-28 shrink-0">
                <div className="pointer-events-none absolute inset-x-0 -top-4 z-20 flex justify-center">
                  {membersPill}
                </div>
                <div className="no-scrollbar h-full overflow-x-auto">
                  <div
                    className={cn(
                      'mx-auto flex h-full w-max min-w-full items-center justify-center gap-2 px-3',
                      isFullscreen ? 'pb-2' : 'pb-3'
                    )}
                  >
                    {otherTracks.map((track) => (
                      <div
                        key={`${track.participant.identity}:${track.source}`}
                        className="aspect-video h-full py-1"
                      >
                        <VoiceTile trackRef={track} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className={cn('min-h-0 flex-1', isFullscreen ? 'p-3' : 'p-4')}>
            <VoiceGrid tracks={tracks} />
          </div>
        )}
      </LayoutContextProvider>
    </div>
  )
}

/** The default (unfocused) call grid — the shared `TileGrid` fed LiveKit `VoiceTile`s.
 *  Paginates past 16 so 50 people stay legible (see `TileGrid`). */
function VoiceGrid({ tracks }: { tracks: TrackReferenceOrPlaceholder[] }): React.JSX.Element {
  return (
    <TileGrid
      tiles={tracks.map((track) => ({
        key: `${track.participant.identity}:${track.source}`,
        node: <VoiceTile trackRef={track} />
      }))}
    />
  )
}

/** Surfaces LiveKit's real connection state so a call that's mid-connect or
 *  reconnecting reads as such (Discord shows "RTC Connecting" / "Reconnecting")
 *  instead of a silent, seemingly-broken empty stage. Nothing when connected. */
function ConnectionStatus(): React.JSX.Element | null {
  const state = useConnectionState()
  if (state === ConnectionState.Connected || state === ConnectionState.Disconnected) return null
  const reconnecting =
    state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting
  return (
    <div className="absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs font-medium text-white backdrop-blur">
      <Spinner className="size-3.5" />
      {reconnecting ? 'Reconnecting…' : 'Connecting…'}
    </div>
  )
}

/** The in-call control bar — mic/camera with device pickers · deafen · screen share
 *  · leave centered, plus the **fullscreen toggle at the bottom-right** (where
 *  Discord puts Exit Full Screen) — driven by the shared `useCallControls` so it
 *  stays in sync with the floating user bar. The SAME bar stays visible in
 *  fullscreen (Discord keeps its controls on screen), just restyled to black. */
function VoiceControlBar({
  isFullscreen,
  uiVisible,
  onToggleFullscreen
}: {
  isFullscreen: boolean
  uiVisible: boolean
  onToggleFullscreen: () => void
}): React.JSX.Element {
  const controls = useCallControls()
  const pushToTalk = useSettingsStore((s) => s.pushToTalk)
  const setPushToTalk = useSettingsStore((s) => s.setPushToTalk)

  return (
    <div
      className={cn(
        'z-20 flex items-center justify-center gap-2 transition-all duration-300',
        isFullscreen
          ? // Floating overlay along the bottom (gradient scrim), slides + fades away
            // when the UI auto-hides.
            'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-3 pt-10 pb-3'
          : 'relative border-t bg-card px-3 py-3',
        isFullscreen && !uiVisible && 'pointer-events-none translate-y-full opacity-0'
      )}
    >
      <DeviceControl
        kind="audioinput"
        enabled={controls.micOn}
        pending={controls.micPending}
        onToggle={controls.toggleMic}
        OnIcon={Microphone}
        OffIcon={MicrophoneSlash}
        label="Microphone"
      />
      <DeviceControl
        kind="videoinput"
        enabled={controls.cameraOn}
        pending={controls.cameraPending}
        onToggle={controls.toggleCamera}
        OnIcon={VideoCamera}
        OffIcon={VideoCameraSlash}
        label="Camera"
      />
      {/* Quick push-to-talk on/off — lit (primary) when active, so normal mode vs
          push-to-talk is obvious at a glance. */}
      <ToggleButton
        active={pushToTalk}
        onClick={() => setPushToTalk(!pushToTalk)}
        title={pushToTalk ? 'Push to talk: On' : 'Push to talk: Off'}
      >
        <PushPin className="size-5" weight={pushToTalk ? 'fill' : 'regular'} />
      </ToggleButton>
      <ToggleButton
        active={controls.deafened}
        danger
        onClick={controls.toggleDeafen}
        title={controls.deafened ? 'Undeafen' : 'Deafen'}
      >
        <DeafenGlyph deafened={controls.deafened} className="size-5" />
      </ToggleButton>
      <ToggleButton
        active={controls.screenOn}
        pending={controls.screenPending}
        onClick={controls.toggleScreenShare}
        title={controls.screenOn ? 'Stop sharing' : 'Share your screen'}
      >
        <Monitor className="size-5" weight={controls.screenOn ? 'fill' : 'regular'} />
      </ToggleButton>

      {/* Discord-style red hangup: icon-only pill, "Disconnect" on hover. */}
      <Tip label="Disconnect">
        <button
          type="button"
          onClick={controls.leave}
          aria-label="Disconnect"
          className="ml-2 flex h-10 items-center justify-center rounded-full bg-destructive px-5 text-white transition-colors hover:bg-destructive/90"
        >
          <PhoneDisconnect className="size-5" weight="fill" />
        </button>
      </Tip>

      {/* Bottom-right, like Discord's Full Screen / Exit Full Screen control. */}
      <Tip label={isFullscreen ? 'Exit Full Screen' : 'Full Screen'}>
        <button
          type="button"
          onClick={onToggleFullscreen}
          aria-label={isFullscreen ? 'Exit Full Screen' : 'Full Screen'}
          className={cn(
            'absolute right-3 flex size-9 items-center justify-center rounded-md transition-colors',
            // Align with the buttons row: centered in the short windowed bar, or at the
            // bottom in the taller gradient fullscreen bar.
            isFullscreen
              ? 'bottom-3 text-white/80 hover:bg-white/10 hover:text-white'
              : 'top-1/2 -translate-y-1/2 text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          {isFullscreen ? <ArrowsIn className="size-5" /> : <ArrowsOut className="size-5" />}
        </button>
      </Tip>

      <ScreenSharePicker
        open={controls.screenPickerOpen}
        onOpenChange={controls.setScreenPickerOpen}
        onPick={controls.pickScreenSource}
      />
    </div>
  )
}

/** A round toggle button. `active` fills it (primary, or destructive when `danger`). */
function ToggleButton({
  active,
  danger,
  pending,
  onClick,
  title,
  children
}: {
  active: boolean
  danger?: boolean
  pending?: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tip label={title}>
      <button
        type="button"
        aria-label={title}
        disabled={pending}
        onClick={onClick}
        className={cn(
          'flex size-10 items-center justify-center rounded-full transition-colors disabled:opacity-50',
          active
            ? danger
              ? // Match the muted mic/camera look (subtle red tint + red icon), not a solid fill.
                'bg-destructive/15 text-destructive hover:bg-destructive/25'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'bg-muted text-foreground hover:bg-muted/70'
        )}
      >
        {children}
      </button>
    </Tip>
  )
}

/** A toggle button + a caret that opens the list of input devices of `kind`,
 *  so a user with several mics/cameras can pick which one is live. */
function DeviceControl({
  kind,
  enabled,
  pending,
  onToggle,
  OnIcon,
  OffIcon,
  label
}: {
  kind: 'audioinput' | 'videoinput'
  enabled: boolean
  pending?: boolean
  onToggle: () => void
  OnIcon: React.ComponentType<{ className?: string; weight?: 'fill' | 'regular' }>
  OffIcon: React.ComponentType<{ className?: string; weight?: 'fill' | 'regular' }>
  label: string
}): React.JSX.Element {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind })

  return (
    <div className="flex items-center rounded-full bg-muted">
      <Tip label={enabled ? `Turn off ${label.toLowerCase()}` : `Turn on ${label.toLowerCase()}`}>
        <button
          type="button"
          aria-label={label}
          disabled={pending}
          onClick={onToggle}
          className={cn(
            'flex size-10 items-center justify-center rounded-full transition-colors disabled:opacity-50',
            enabled ? 'text-foreground hover:bg-muted/70' : 'bg-destructive/15 text-destructive'
          )}
        >
          {enabled ? <OnIcon className="size-5" /> : <OffIcon className="size-5" />}
        </button>
      </Tip>
      <Popover>
        <Tip label={`Choose ${label.toLowerCase()}`}>
          <PopoverTrigger
            aria-label={`Choose ${label.toLowerCase()}`}
            className="flex h-10 items-center rounded-r-full pr-2 pl-1 text-muted-foreground hover:text-foreground"
          >
            <CaretDown className="size-3" weight="bold" />
          </PopoverTrigger>
        </Tip>
        <PopoverContent align="start" className="w-64 p-1">
          <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{label}</p>
          {devices.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">No devices found.</p>
          ) : (
            devices.map((device, index) => (
              <button
                key={device.deviceId || index}
                type="button"
                onClick={() => void setActiveMediaDevice(device.deviceId)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <Check
                  className={cn(
                    'size-4 shrink-0',
                    device.deviceId === activeDeviceId ? 'opacity-100' : 'opacity-0'
                  )}
                  weight="bold"
                />
                <span className="truncate">{device.label || `${label} ${index + 1}`}</span>
              </button>
            ))
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
