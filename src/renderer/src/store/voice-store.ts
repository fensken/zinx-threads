import { create } from 'zustand'

/** The voice/video call the user is currently connected to. Lives at the app
 *  shell (not the channel view), so the call PERSISTS while you browse other
 *  channels — and both the channel view and the floating user bar read/control it
 *  through this one store (Discord-style). */
export interface ActiveCall {
  channelId: string
  channelName: string
  workspaceSlug: string
  /** LiveKit join token (minted by `convex/voice.ts`). */
  token: string
}

// Persisted "how do I join a call" preferences — set from the floating user bar
// even when you're NOT in a call, applied when you next join (Discord's model:
// your mute/deafen/camera state carries into every call). Kept in localStorage.
const PREFS_KEY = 'zinx-voice-prefs'
interface JoinPrefs {
  joinMuted: boolean
  joinVideo: boolean
  joinDeafened: boolean
  /** Selected input/output devices (`''` = the system default). Applied to the call
   *  (see `voice/device-applier.tsx`). */
  micDeviceId: string
  speakerDeviceId: string
  cameraDeviceId: string
}
function readPrefs(): JoinPrefs {
  const fallback: JoinPrefs = {
    joinMuted: false,
    joinVideo: false,
    joinDeafened: false,
    micDeviceId: '',
    speakerDeviceId: '',
    cameraDeviceId: ''
  }
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(PREFS_KEY) : null
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<JoinPrefs>
      return {
        joinMuted: Boolean(parsed.joinMuted),
        joinVideo: Boolean(parsed.joinVideo),
        joinDeafened: Boolean(parsed.joinDeafened),
        micDeviceId: typeof parsed.micDeviceId === 'string' ? parsed.micDeviceId : '',
        speakerDeviceId: typeof parsed.speakerDeviceId === 'string' ? parsed.speakerDeviceId : '',
        cameraDeviceId: typeof parsed.cameraDeviceId === 'string' ? parsed.cameraDeviceId : ''
      }
    }
  } catch {
    // ignore corrupt/absent prefs
  }
  return fallback
}
function writePrefs(prefs: JoinPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // ignore
  }
}

/** Per-user local audio (Discord: right-click a member → Mute + volume slider).
 *  Local-only, keyed by the user id (= LiveKit participant identity): `volume` is
 *  0–1, `muted` forces it to 0 without losing the slider value. Session-scoped. */
export interface UserAudioPref {
  volume: number
  muted: boolean
}

interface VoiceStore extends JoinPrefs {
  /** The connected call, or null when not in a call. */
  call: ActiveCall | null
  /** The channel id we're mid-join on (shows a spinner), or null. */
  connecting: string | null
  /** Deafened = can't hear anyone (and mic is forced off). Purely local. */
  deafened: boolean
  /** User ids of everyone currently talking in the call — mirrored from LiveKit's
   *  active-speakers event so the sidebar + user bar can glow their avatars
   *  (LiveKit only knows the room YOU'RE in, so this is your current call). */
  speakingUserIds: string[]
  /** Per-user local mute / volume for their MICROPHONE, keyed by user id. */
  userAudio: Record<string, UserAudioPref>
  /** Per-user local mute / volume for their SCREEN-SHARE audio (a separate LiveKit
   *  track from the mic), keyed by user id. */
  screenAudio: Record<string, UserAudioPref>

  setConnecting: (channelId: string | null) => void
  join: (call: ActiveCall) => void
  leave: () => void
  setDeafened: (deafened: boolean) => void
  setSpeaking: (userIds: string[]) => void
  setUserVolume: (userId: string, volume: number) => void
  toggleUserMute: (userId: string) => void
  setScreenVolume: (userId: string, volume: number) => void
  toggleScreenMute: (userId: string) => void

  // Pre-call config (persisted).
  setJoinMuted: (joinMuted: boolean) => void
  setJoinVideo: (joinVideo: boolean) => void
  setJoinDeafened: (joinDeafened: boolean) => void
  // Device selection (persisted).
  setMicDeviceId: (micDeviceId: string) => void
  setSpeakerDeviceId: (speakerDeviceId: string) => void
  setCameraDeviceId: (cameraDeviceId: string) => void
}

/** Extract the persisted prefs slice from the store state (so a setter writing one
 *  field carries the rest). */
function prefsOf(state: JoinPrefs): JoinPrefs {
  return {
    joinMuted: state.joinMuted,
    joinVideo: state.joinVideo,
    joinDeafened: state.joinDeafened,
    micDeviceId: state.micDeviceId,
    speakerDeviceId: state.speakerDeviceId,
    cameraDeviceId: state.cameraDeviceId
  }
}

export const useVoiceStore = create<VoiceStore>((set) => ({
  call: null,
  connecting: null,
  deafened: false,
  speakingUserIds: [],
  userAudio: {},
  screenAudio: {},
  ...readPrefs(),

  setConnecting: (connecting) => set({ connecting }),
  // Joining applies your persisted deafen preference (mute/video are applied by the
  // LiveKitRoom's `audio`/`video` props reading these prefs).
  join: (call) => set((state) => ({ call, connecting: null, deafened: state.joinDeafened })),
  // Leaving a call resets deafen/speakers but keeps per-user volume prefs for the
  // session (re-joining the same people should remember you turned someone down).
  leave: () => set({ call: null, connecting: null, deafened: false, speakingUserIds: [] }),
  setDeafened: (deafened) => set({ deafened }),
  setSpeaking: (speakingUserIds) => set({ speakingUserIds }),
  setUserVolume: (userId, volume) =>
    set((state) => ({
      userAudio: {
        ...state.userAudio,
        [userId]: { volume, muted: state.userAudio[userId]?.muted ?? false }
      }
    })),
  toggleUserMute: (userId) =>
    set((state) => {
      const current = state.userAudio[userId] ?? { volume: 1, muted: false }
      return { userAudio: { ...state.userAudio, [userId]: { ...current, muted: !current.muted } } }
    }),
  setScreenVolume: (userId, volume) =>
    set((state) => ({
      screenAudio: {
        ...state.screenAudio,
        [userId]: { volume, muted: state.screenAudio[userId]?.muted ?? false }
      }
    })),
  toggleScreenMute: (userId) =>
    set((state) => {
      const current = state.screenAudio[userId] ?? { volume: 1, muted: false }
      return {
        screenAudio: { ...state.screenAudio, [userId]: { ...current, muted: !current.muted } }
      }
    }),

  setJoinMuted: (joinMuted) =>
    set((state) => {
      writePrefs({ ...prefsOf(state), joinMuted })
      return { joinMuted }
    }),
  setJoinVideo: (joinVideo) =>
    set((state) => {
      writePrefs({ ...prefsOf(state), joinVideo })
      return { joinVideo }
    }),
  setJoinDeafened: (joinDeafened) =>
    set((state) => {
      writePrefs({ ...prefsOf(state), joinDeafened })
      return { joinDeafened }
    }),
  setMicDeviceId: (micDeviceId) =>
    set((state) => {
      writePrefs({ ...prefsOf(state), micDeviceId })
      return { micDeviceId }
    }),
  setSpeakerDeviceId: (speakerDeviceId) =>
    set((state) => {
      writePrefs({ ...prefsOf(state), speakerDeviceId })
      return { speakerDeviceId }
    }),
  setCameraDeviceId: (cameraDeviceId) =>
    set((state) => {
      writePrefs({ ...prefsOf(state), cameraDeviceId })
      return { cameraDeviceId }
    })
}))
