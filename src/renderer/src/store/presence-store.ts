import { create } from 'zustand'

/** Live connectivity from the `@convex-dev/presence` component — who currently has the
 *  app connected (heartbeating). This is the *liveness* layer, separate from a user's
 *  chosen status (Online/Away/DND/Invisible): connectivity decides connected-vs-offline,
 *  the manual status decides how you look while connected. Written once by the
 *  `PresenceReporter`; read via `useIsOnline`. Mirrors the `voice-store` speaking set. */
interface PresenceStore {
  /** True once the presence list has loaded — before that, don't force anyone offline. */
  ready: boolean
  /** User ids currently connected (app open + heartbeating, not backgrounded). */
  onlineIds: Set<string>
  set: (ready: boolean, onlineIds: Set<string>) => void
}

export const usePresenceStore = create<PresenceStore>((set) => ({
  ready: false,
  onlineIds: new Set(),
  set: (ready, onlineIds) => set({ ready, onlineIds })
}))

/** Connectivity of a user:
 *  - `undefined` → presence not loaded yet → callers show the manual status as-is.
 *  - `false` → disconnected → callers show offline regardless of manual status.
 *  - `true` → connected → callers show the manual status. */
export function useIsOnline(userId: string | null | undefined): boolean | undefined {
  return usePresenceStore((state) =>
    !state.ready || !userId ? undefined : state.onlineIds.has(userId)
  )
}
