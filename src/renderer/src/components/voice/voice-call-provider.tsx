import '@livekit/components-styles'
import { useEffect, useRef } from 'react'
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useLocalParticipant,
  useRoomContext
} from '@livekit/components-react'
import { RoomEvent, type Participant } from 'livekit-client'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { useVoiceStore } from '@renderer/store/voice-store'
import { playJoinSound, playLeaveSound } from '@renderer/lib/sounds'
import { errorMessage } from '@renderer/lib/convex-error'

// The LiveKit server URL (public; the minted token is the capability). Absent →
// voice is off and this is a passthrough.
const SERVER_URL = import.meta.env.VITE_LIVEKIT_URL as string | undefined

/**
 * Wraps the whole workspace shell in a single LiveKit room so a voice/video call
 * **persists while you navigate** and is controllable from anywhere inside — the
 * channel view renders the tiles, the floating user bar drives mute/camera/leave,
 * both through the same room context (Discord-style).
 *
 * The room is always mounted (when a server is configured) but only **connects**
 * once `voice-store.call` is set, so joining/leaving never remounts the shell.
 * `display: contents` keeps LiveKit's wrapper `<div>` out of the flex layout.
 */
export function VoiceCallProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const call = useVoiceStore((state) => state.call)
  const leave = useVoiceStore((state) => state.leave)
  const deafened = useVoiceStore((state) => state.deafened)
  // Your pre-call config (set from the user bar while idle) decides how you join.
  const joinMuted = useVoiceStore((state) => state.joinMuted)
  const joinVideo = useVoiceStore((state) => state.joinVideo)

  if (!SERVER_URL) return <>{children}</>

  return (
    <LiveKitRoom
      serverUrl={SERVER_URL}
      token={call?.token ?? ''}
      connect={Boolean(call)}
      audio={!joinMuted}
      video={joinVideo}
      onDisconnected={() => leave()}
      onError={(error) => {
        toast.error(errorMessage(error, 'Lost connection to the call'))
        leave()
      }}
      style={{ display: 'contents' }}
    >
      {children}
      {call ? <RoomAudioRenderer muted={deafened} /> : null}
      {call ? <CallSounds /> : null}
      {call ? <VoicePresenceReporter channelId={call.channelId} /> : null}
      {call ? <SpeakingTracker /> : null}
    </LiveKitRoom>
  )
}

/** Mirrors LiveKit's active-speaker set (participant `identity` = our user id) into
 *  the voice store, so the sidebar + user bar can glow the avatars of whoever's
 *  talking. Fires only when the speaker set changes, not per audio frame. */
function SpeakingTracker(): null {
  const room = useRoomContext()
  const setSpeaking = useVoiceStore((state) => state.setSpeaking)
  useEffect(() => {
    const update = (speakers: Participant[]): void => setSpeaking(speakers.map((s) => s.identity))
    room.on(RoomEvent.ActiveSpeakersChanged, update)
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, update)
    }
  }, [room, setSpeaking])
  return null
}

/** Reports the caller's presence (which voice channel they're in, + their in-call
 *  status: mute / deafen / video / screen share) to Convex so the sidebar can show
 *  who's connected and how — upsert on join + a heartbeat, cleared on leave. A
 *  missed heartbeat (crash) is aged out server-side by the TTL. */
function VoicePresenceReporter({ channelId }: { channelId: string }): null {
  const setPresence = useMutation(api.voice.setPresence)
  const clearPresence = useMutation(api.voice.clearPresence)
  const { isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled } = useLocalParticipant()
  const deafened = useVoiceStore((state) => state.deafened)

  const muted = !isMicrophoneEnabled
  const videoOn = isCameraEnabled
  const screenSharing = isScreenShareEnabled
  // Latest status for the heartbeat, without re-running (and thus clearing) the
  // join/heartbeat effect when it changes.
  const stateRef = useRef({ muted, deafened, videoOn, screenSharing })

  useEffect(() => {
    const report = (): void => {
      void setPresence({
        channelId: channelId as Id<'channels'>,
        ...stateRef.current
      }).catch(() => {})
    }
    report()
    const interval = window.setInterval(report, 20_000)
    return () => {
      window.clearInterval(interval)
      void clearPresence().catch(() => {})
    }
  }, [channelId, setPresence, clearPresence])

  // Report status changes immediately (no clear/rejoin).
  useEffect(() => {
    stateRef.current = { muted, deafened, videoOn, screenSharing }
    void setPresence({
      channelId: channelId as Id<'channels'>,
      muted,
      deafened,
      videoOn,
      screenSharing
    }).catch(() => {})
  }, [channelId, setPresence, muted, deafened, videoOn, screenSharing])
  return null
}

/** Discord-style chimes: rising when you join (this mounts on connect) or anyone
 *  else joins, falling when you leave (unmount) or anyone else leaves. */
function CallSounds(): null {
  const room = useRoomContext()
  useEffect(() => {
    const onJoin = (): void => playJoinSound()
    const onLeave = (): void => playLeaveSound()
    room.on(RoomEvent.ParticipantConnected, onJoin)
    room.on(RoomEvent.ParticipantDisconnected, onLeave)
    playJoinSound() // you joined
    return () => {
      room.off(RoomEvent.ParticipantConnected, onJoin)
      room.off(RoomEvent.ParticipantDisconnected, onLeave)
      playLeaveSound() // you left
    }
  }, [room])
  return null
}
