import { useEffect, useState } from 'react'
import {
  VideoTrack,
  isTrackReference,
  useConnectionQualityIndicator,
  useEnsureTrackRef,
  useIsSpeaking,
  useMaybeLayoutContext,
  type TrackReferenceOrPlaceholder
} from '@livekit/components-react'
import {
  ConnectionQuality,
  ParticipantEvent,
  RemoteParticipant,
  Track,
  type Participant
} from 'livekit-client'
import {
  ArrowsIn,
  ArrowsOut,
  MicrophoneSlash,
  SpeakerHigh,
  SpeakerSlash,
  WifiLow,
  WifiSlash
} from '@phosphor-icons/react'
import { useWorkspaceDirectory } from '@renderer/components/chat/workspace-directory-context'
import { Avatar } from '@renderer/components/common/avatar'
import { sameTrack } from '@renderer/lib/track-ref'
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { Slider } from '@renderer/components/ui/slider'
import { Tip } from '@renderer/components/ui/tooltip'
import { useVoiceStore } from '@renderer/store/voice-store'
import { cn } from '@renderer/lib/utils'

const TILE_BASE =
  'lk-participant-tile group/tile relative flex h-full w-full items-center justify-center overflow-hidden'

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Reactive "is this participant's mic muted" (LiveKit mutates the participant in
 *  place, so we subscribe to its track events rather than reading a getter). */
function useMicMuted(participant: Participant): boolean {
  const [muted, setMuted] = useState(!participant.isMicrophoneEnabled)
  useEffect(() => {
    const update = (): void => setMuted(!participant.isMicrophoneEnabled)
    update()
    participant.on(ParticipantEvent.TrackMuted, update)
    participant.on(ParticipantEvent.TrackUnmuted, update)
    participant.on(ParticipantEvent.TrackPublished, update)
    participant.on(ParticipantEvent.TrackUnpublished, update)
    return () => {
      participant.off(ParticipantEvent.TrackMuted, update)
      participant.off(ParticipantEvent.TrackUnmuted, update)
      participant.off(ParticipantEvent.TrackPublished, update)
      participant.off(ParticipantEvent.TrackUnpublished, update)
    }
  }, [participant])
  return muted
}

/** Applies your local volume / mute to a REMOTE participant's audio of `source`
 *  (their MICROPHONE, or their SCREEN-SHARE audio — separate LiveKit tracks). Discord's
 *  right-click volume. Re-applies on pref change OR (re)subscribe so a rejoin/unmute
 *  keeps the level you set. No-op for yourself. */
function useApplyLocalVolume(
  participant: Participant,
  volume: number,
  muted: boolean,
  source: Track.Source.Microphone | Track.Source.ScreenShareAudio
): void {
  useEffect(() => {
    if (!(participant instanceof RemoteParticipant)) return
    const apply = (): void => participant.setVolume(muted ? 0 : volume, source)
    apply()
    participant.on(ParticipantEvent.TrackSubscribed, apply)
    return () => {
      participant.off(ParticipantEvent.TrackSubscribed, apply)
    }
  }, [participant, volume, muted, source])
}

/** Live resolution + fps of a video track, read from the MediaStreamTrack's actual
 *  settings (works for local AND remote). Refreshed periodically since a screen
 *  share's resolution/fps adapt to bandwidth. */
function useVideoSettings(
  ref: TrackReferenceOrPlaceholder
): { width?: number; height?: number; frameRate?: number } | null {
  const mst = isTrackReference(ref) ? ref.publication?.track?.mediaStreamTrack : undefined
  const [settings, setSettings] = useState<MediaTrackSettings | null>(() =>
    mst ? mst.getSettings() : null
  )
  useEffect(() => {
    if (!mst) return
    const read = (): void => setSettings(mst.getSettings())
    read()
    const interval = window.setInterval(read, 2000)
    return () => window.clearInterval(interval)
  }, [mst])
  // Mask any stale settings from a previous track when there's no live one; the
  // effect repopulates once a new track arrives (avoids a setState in the effect body).
  return mst ? settings : null
}

/** Reactive "does this participant have a live SCREEN-SHARE audio track" — gates the
 *  screen-share volume control (no point offering it for a silent share). */
function useHasScreenAudio(participant: Participant): boolean {
  const [has, setHas] = useState(() =>
    Boolean(participant.getTrackPublication(Track.Source.ScreenShareAudio))
  )
  useEffect(() => {
    const update = (): void =>
      setHas(Boolean(participant.getTrackPublication(Track.Source.ScreenShareAudio)))
    update()
    participant.on(ParticipantEvent.TrackPublished, update)
    participant.on(ParticipantEvent.TrackUnpublished, update)
    participant.on(ParticipantEvent.TrackSubscribed, update)
    return () => {
      participant.off(ParticipantEvent.TrackPublished, update)
      participant.off(ParticipantEvent.TrackUnpublished, update)
      participant.off(ParticipantEvent.TrackSubscribed, update)
    }
  }, [participant])
  return has
}

/** Discord-style signal indicator — only shown when the connection is degraded
 *  (poor / lost), so a healthy call stays uncluttered. */
function QualityBadge({ participant }: { participant: Participant }): React.JSX.Element | null {
  const { quality } = useConnectionQualityIndicator({ participant })
  if (quality === ConnectionQuality.Poor) {
    return (
      <Tip label="Poor connection">
        <span className="flex size-5 items-center justify-center rounded bg-black/60 text-amber-400 backdrop-blur">
          <WifiLow className="size-3.5" weight="bold" />
        </span>
      </Tip>
    )
  }
  if (quality === ConnectionQuality.Lost) {
    return (
      <Tip label="Connection lost">
        <span className="flex size-5 items-center justify-center rounded bg-black/60 text-destructive backdrop-blur">
          <WifiSlash className="size-3.5" weight="bold" />
        </span>
      </Tip>
    )
  }
  return null
}

/** The mute toggle + 0–200% volume slider body, shared by the right-click context
 *  menu and the hover popover so both stay in lockstep. */
function VolumeControls({
  id,
  isScreen,
  volume,
  locallyMuted,
  setVolume,
  toggleMute
}: {
  id: string
  isScreen: boolean
  volume: number
  locallyMuted: boolean
  setVolume: (id: string, value: number) => void
  toggleMute: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        aria-label={locallyMuted ? 'Unmute' : 'Mute'}
        onClick={() => toggleMute(id)}
        className={cn(
          'shrink-0 transition-colors',
          locallyMuted ? 'text-destructive' : 'text-muted-foreground hover:text-foreground'
        )}
      >
        {locallyMuted ? <SpeakerSlash className="size-4" /> : <SpeakerHigh className="size-4" />}
      </button>
      <Slider
        value={[Math.round(volume * 100)]}
        min={0}
        max={200}
        step={5}
        disabled={locallyMuted}
        onValueChange={(next) => setVolume(id, (next[0] ?? 100) / 100)}
        aria-label={isScreen ? 'Screen volume' : 'User volume'}
      />
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {Math.round(volume * 100)}%
      </span>
    </div>
  )
}

/** A hover-revealed speaker button (bottom-right of a tile) that opens a small
 *  volume popover — so a viewer discovers they can adjust a shared screen's audio
 *  (or another member's mic) without knowing to right-click. */
function TileVolumeControl({
  id,
  isScreen,
  name,
  volume,
  locallyMuted,
  setVolume,
  toggleMute
}: {
  id: string
  isScreen: boolean
  name: string
  volume: number
  locallyMuted: boolean
  setVolume: (id: string, value: number) => void
  toggleMute: (id: string) => void
}): React.JSX.Element {
  return (
    <Popover>
      <Tip label={isScreen ? 'Screen volume' : 'Volume'}>
        <PopoverTrigger
          aria-label={isScreen ? 'Adjust screen volume' : 'Adjust volume'}
          onClick={(event) => event.stopPropagation()}
          className="absolute right-2 bottom-2 z-10 flex size-7 items-center justify-center rounded-md bg-black/50 text-white opacity-0 backdrop-blur transition-opacity group-hover/tile:opacity-100 data-[popup-open]:opacity-100"
        >
          {locallyMuted ? (
            <SpeakerSlash className="size-4 text-destructive" weight="fill" />
          ) : (
            <SpeakerHigh className="size-4" weight="fill" />
          )}
        </PopoverTrigger>
      </Tip>
      <PopoverContent
        side="top"
        align="end"
        className="w-64 p-3"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="mb-2 truncate text-xs font-medium text-foreground">
          {isScreen ? `${name}’s screen` : name}
        </p>
        <VolumeControls
          id={id}
          isScreen={isScreen}
          volume={volume}
          locallyMuted={locallyMuted}
          setVolume={setVolume}
          toggleMute={toggleMute}
        />
      </PopoverContent>
    </Popover>
  )
}

/**
 * A call tile that shows the participant's **actual avatar photo** (looked up by
 * their id in the workspace directory) when their camera is off — instead of
 * LiveKit's generic silhouette — and their camera/screen video when on. Name pill
 * with a mic-muted slash, speaking glow, a focus button on hover, and a right-click
 * menu to locally mute / set the per-user volume (Discord). Reads its track from the
 * grid/carousel context, or takes it as a prop (focus).
 */
export function VoiceTile({
  trackRef,
  flush
}: {
  trackRef?: TrackReferenceOrPlaceholder
  /** Edge-to-edge (no rounding, black bg) — for the focused tile in fullscreen. */
  flush?: boolean
}): React.JSX.Element {
  const ref = useEnsureTrackRef(trackRef)
  const participant = ref.participant
  const directory = useWorkspaceDirectory()
  // Resolve by id; for YOUR OWN tile fall back to the `isMe` member so it never
  // flashes "Guest" in the moment before LiveKit propagates the participant name.
  const member =
    directory?.members.find((entry) => entry.userId === participant.identity) ??
    (participant.isLocal ? directory?.members.find((entry) => entry.isMe) : undefined)
  const speaking = useIsSpeaking(participant)
  const micMuted = useMicMuted(participant)

  const id = participant.identity
  const isScreen = ref.source === Track.Source.ScreenShare
  const hasScreenAudio = useHasScreenAudio(participant)
  const videoSettings = useVideoSettings(ref)

  // A screen tile controls the SCREEN-SHARE audio; a person tile controls their MIC —
  // separate LiveKit tracks with separate volume + separate prefs.
  const audioSource = isScreen ? Track.Source.ScreenShareAudio : Track.Source.Microphone
  const userAudioPref = useVoiceStore((state) => state.userAudio[participant.identity])
  const screenAudioPref = useVoiceStore((state) => state.screenAudio[participant.identity])
  const setUserVolume = useVoiceStore((state) => state.setUserVolume)
  const toggleUserMute = useVoiceStore((state) => state.toggleUserMute)
  const setScreenVolume = useVoiceStore((state) => state.setScreenVolume)
  const toggleScreenMute = useVoiceStore((state) => state.toggleScreenMute)
  const pref = isScreen ? screenAudioPref : userAudioPref
  const volume = pref?.volume ?? 1
  const locallyMuted = pref?.muted ?? false
  const setVolume = isScreen ? setScreenVolume : setUserVolume
  const toggleMute = isScreen ? toggleScreenMute : toggleUserMute
  useApplyLocalVolume(participant, volume, locallyMuted, audioSource)

  const hasVideo =
    isTrackReference(ref) &&
    Boolean(ref.publication?.isSubscribed) &&
    !ref.publication?.isMuted &&
    Boolean(ref.publication?.track)

  // Focus/pin (Discord: click a tile — or its hover expand button — to spotlight it;
  // click the expand button on the focused tile to go back to the grid). Custom
  // instead of LiveKit's FocusToggle so the WHOLE tile is clickable, not just the
  // small hover button.
  const layout = useMaybeLayoutContext()
  const pinned = (layout?.pin.state ?? []).some((t) => sameTrack(t, ref))
  const canPin = Boolean(layout?.pin.dispatch)
  const togglePin = (): void => {
    if (!layout?.pin.dispatch) return
    if (pinned) layout.pin.dispatch({ msg: 'clear_pin' })
    else layout.pin.dispatch({ msg: 'set_pin', trackReference: ref })
  }
  // Whole-tile click focuses only UNfocused tiles — clicking the big focused view
  // must not accidentally unfocus it (use the button for that).
  const clickToFocus = canPin && !pinned

  const name = member?.name ?? participant.name ?? 'Guest'
  const tileClass = cn(
    TILE_BASE,
    flush ? 'bg-black' : 'rounded-xl bg-muted',
    clickToFocus && 'cursor-pointer'
  )
  // Volume menu is offered on REMOTE tiles: a person tile (their mic) always, a
  // SCREEN tile only when the share actually carries audio. Never on your own tiles.
  const canControl = !participant.isLocal && (isScreen ? hasScreenAudio : true)

  const inner = (
    <>
      {hasVideo ? (
        <VideoTrack
          trackRef={ref}
          className={cn('h-full w-full', isScreen ? 'object-contain' : 'object-cover')}
        />
      ) : (
        <Avatar
          initials={initialsOf(name)}
          color={member?.color ?? '#5865f2'}
          image={member?.avatarUrl}
          className="size-16 text-xl"
        />
      )}

      <div className="absolute top-2 left-2 z-10 flex items-center gap-1">
        {isScreen ? (
          // Live stream info for a shared screen: resolution · fps · audio on/off.
          <span className="flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-0.5 text-[11px] text-white backdrop-blur">
            {videoSettings?.width && videoSettings.height ? (
              <span className="tabular-nums">
                {videoSettings.width}×{videoSettings.height}
                {videoSettings.frameRate ? ` · ${Math.round(videoSettings.frameRate)}fps` : ''}
              </span>
            ) : (
              <span>Screen</span>
            )}
            {hasScreenAudio ? (
              <Tip label="Sharing audio">
                <SpeakerHigh
                  className="size-3 text-emerald-400"
                  weight="fill"
                  aria-label="Audio on"
                />
              </Tip>
            ) : (
              <Tip label="No audio shared">
                <SpeakerSlash className="size-3 text-white/50" aria-label="No audio" />
              </Tip>
            )}
          </span>
        ) : (
          <QualityBadge participant={participant} />
        )}
      </div>

      <div className="absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] items-center gap-1 rounded-md bg-black/60 px-2 py-0.5 text-xs text-white backdrop-blur">
        {micMuted && !isScreen ? (
          <MicrophoneSlash className="size-3 shrink-0 text-destructive" weight="fill" />
        ) : null}
        {locallyMuted ? (
          <SpeakerSlash
            className="size-3 shrink-0 text-destructive"
            weight="fill"
            aria-label="Muted for you"
          />
        ) : null}
        <span className="truncate">{isScreen ? `${name}’s screen` : name}</span>
      </div>

      {/* Hover expand button — focus this tile / return the focused one to grid. */}
      {canPin ? (
        <Tip label={pinned ? 'Back to grid' : 'Focus'}>
          <button
            type="button"
            aria-label={pinned ? 'Back to grid' : 'Focus'}
            onClick={(event) => {
              event.stopPropagation()
              togglePin()
            }}
            className="absolute top-2 right-2 z-10 flex size-7 items-center justify-center rounded-md bg-black/50 text-white opacity-0 backdrop-blur transition-opacity group-hover/tile:opacity-100"
          >
            {pinned ? <ArrowsIn className="size-4" /> : <ArrowsOut className="size-4" />}
          </button>
        </Tip>
      ) : null}
    </>
  )

  if (!canControl) {
    return (
      <div
        data-lk-speaking={speaking}
        className={tileClass}
        onClick={clickToFocus ? togglePin : undefined}
      >
        {inner}
      </div>
    )
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<div data-lk-speaking={speaking} onClick={clickToFocus ? togglePin : undefined} />}
        className={tileClass}
      >
        {inner}
        {/* Hover speaker button → volume popover, so the control is discoverable
            without right-clicking (Discord surfaces stream volume the same way). */}
        <TileVolumeControl
          id={id}
          isScreen={isScreen}
          name={name}
          volume={volume}
          locallyMuted={locallyMuted}
          setVolume={setVolume}
          toggleMute={toggleMute}
        />
      </ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuLabel className="truncate">
          {isScreen ? `${name}’s screen` : name}
        </ContextMenuLabel>
        <ContextMenuCheckboxItem checked={locallyMuted} onCheckedChange={() => toggleMute(id)}>
          {isScreen ? 'Mute screen audio' : 'Mute for me'}
        </ContextMenuCheckboxItem>
        <ContextMenuSeparator />
        {/* Volume slider — a plain row (not a menu item) so dragging it doesn't
            dismiss the menu; Discord allows boosting up to 200%. */}
        <div className="px-2 py-1.5" onContextMenu={(event) => event.preventDefault()}>
          <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
            <span>{isScreen ? 'Screen volume' : 'User volume'}</span>
            <span className="tabular-nums">{Math.round(volume * 100)}%</span>
          </div>
          <Slider
            value={[Math.round(volume * 100)]}
            min={0}
            max={200}
            step={5}
            disabled={locallyMuted}
            onValueChange={(next) => setVolume(id, (next[0] ?? 100) / 100)}
          />
        </div>
      </ContextMenuContent>
    </ContextMenu>
  )
}
