import { useCallback, useState } from 'react'
import { useTrackToggle } from '@livekit/components-react'
import { Track } from 'livekit-client'
import { toast } from 'sonner'
import { useVoiceStore } from '@renderer/store/voice-store'
import { platform } from '@renderer/lib/platform'
import type { ScreenShareOptions } from '@renderer/components/voice/screen-share-picker'
import {
  playDeafenSound,
  playMuteSound,
  playScreenShareStartSound,
  playScreenShareStopSound,
  playUndeafenSound,
  playUnmuteSound
} from '@renderer/lib/call-sounds'

export interface CallControls {
  micOn: boolean
  micPending: boolean
  cameraOn: boolean
  cameraPending: boolean
  screenOn: boolean
  screenPending: boolean
  deafened: boolean
  toggleMic: () => void
  toggleCamera: () => void
  toggleDeafen: () => void
  toggleScreenShare: () => void
  leave: () => void
  /** Desktop screen-share picker state (web uses the browser's native picker). */
  screenPickerOpen: boolean
  setScreenPickerOpen: (open: boolean) => void
  pickScreenSource: (id: string, options: ScreenShareOptions) => void
}

/**
 * One place for every in-call control — mic, camera, deafen, screen share, leave —
 * wired to the shell's LiveKit room + the voice store, with Discord-style sound
 * effects. Shared by BOTH the in-call control bar and the floating user bar so they
 * stay in lockstep. Only call inside the room context (i.e. while in a call).
 */
export function useCallControls(): CallControls {
  const deafened = useVoiceStore((state) => state.deafened)
  const setDeafened = useVoiceStore((state) => state.setDeafened)
  const leave = useVoiceStore((state) => state.leave)
  // Keep the persisted pre-call prefs in sync with live changes, so your state
  // carries into the next call (Discord model).
  const setJoinMuted = useVoiceStore((state) => state.setJoinMuted)
  const setJoinVideo = useVoiceStore((state) => state.setJoinVideo)
  const setJoinDeafened = useVoiceStore((state) => state.setJoinDeafened)
  // getUserMedia / getDisplayMedia failures are reported HERE by LiveKit — they do
  // NOT reject `toggle()`. Without this handler a failed mic/camera/screen-share
  // would silently do nothing. Surfacing it is what turns "screen share isn't
  // working" into an actionable message (e.g. a denied OS screen-recording
  // permission, or system-audio loopback being unavailable).
  const handleDeviceError = useCallback((error: Error): void => {
    console.error('[voice] device error:', error)
    toast.error(error?.message ? `Media error: ${error.message}` : 'A device could not start')
  }, [])

  const mic = useTrackToggle({
    source: Track.Source.Microphone,
    onDeviceError: handleDeviceError
  })
  const camera = useTrackToggle({
    source: Track.Source.Camera,
    onDeviceError: handleDeviceError
  })
  const screen = useTrackToggle({
    source: Track.Source.ScreenShare,
    captureOptions: { audio: true },
    onDeviceError: handleDeviceError
  })
  const [screenPickerOpen, setScreenPickerOpen] = useState(false)

  const toggleMic = (): void => {
    // Unmuting while deafened un-deafens and turns the mic on.
    if (deafened) {
      setDeafened(false)
      setJoinDeafened(false)
      if (!mic.enabled) void mic.toggle()
      setJoinMuted(false)
      playUndeafenSound()
      return
    }
    const willMute = mic.enabled
    void mic.toggle()
    setJoinMuted(willMute)
    if (willMute) playMuteSound()
    else playUnmuteSound()
  }

  const toggleDeafen = (): void => {
    const next = !deafened
    setDeafened(next)
    setJoinDeafened(next)
    if (next) {
      // Deafening forces your mic off — you can't talk into a call you can't hear.
      if (mic.enabled) void mic.toggle()
      setJoinMuted(true)
      playDeafenSound()
    } else {
      playUndeafenSound()
    }
  }

  const toggleCamera = (): void => {
    setJoinVideo(!camera.enabled)
    void camera.toggle()
  }

  const toggleScreenShare = (): void => {
    if (screen.enabled) {
      playScreenShareStopSound()
      void screen.toggle()
      return
    }
    // Leave fullscreen FIRST — both native window fullscreen (Electron) and HTML
    // fullscreen (web). The share picker portals to document.body at a LOWER z-index
    // than the fullscreen call overlay (z-100), so opened while fullscreen it would
    // sit hidden BEHIND the call — the classic "the picker never appears".
    void platform.setWindowFullScreen(false)
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    if (platform.isElectron) {
      console.debug('[voice] opening desktop screen-share picker')
      setScreenPickerOpen(true) // → our custom picker (Applications / Entire Screen)
    } else {
      console.debug('[voice] web: using the browser getDisplayMedia picker')
      playScreenShareStartSound()
      void screen.toggle() // the browser shows its own picker on getDisplayMedia
    }
  }

  const pickScreenSource = (id: string, options: ScreenShareOptions): void => {
    void platform.setScreenShareSource(id, options.audio).then(() => {
      setScreenPickerOpen(false)
      playScreenShareStartSound()
      // Pass audio + resolution/fps to LiveKit's getDisplayMedia request (the Electron
      // handler provides the source; these constraints set the capture quality). The
      // toggle is typed as a union — cast to the screen-share (captureOptions) form.
      const startShare = screen.toggle as (
        force: boolean,
        captureOptions: {
          audio?: boolean
          resolution?: { width: number; height: number; frameRate?: number }
        }
      ) => Promise<unknown>
      void startShare(true, { audio: options.audio, resolution: options.resolution })
    })
  }

  return {
    micOn: mic.enabled && !deafened,
    micPending: mic.pending,
    cameraOn: camera.enabled,
    cameraPending: camera.pending,
    screenOn: screen.enabled,
    screenPending: screen.pending,
    deafened,
    toggleMic,
    toggleCamera,
    toggleDeafen,
    toggleScreenShare,
    leave,
    screenPickerOpen,
    setScreenPickerOpen,
    pickScreenSource
  }
}
