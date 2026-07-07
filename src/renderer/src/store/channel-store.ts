import { create } from 'zustand'

interface ChannelState {
  /** In-session channel name overrides (rename). Swap for Convex later. */
  names: Record<string, string>
  renameChannel: (channelId: string, name: string) => void
}

export const useChannelStore = create<ChannelState>((set) => ({
  names: {},
  renameChannel: (channelId, name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    set((state) => ({ names: { ...state.names, [channelId]: trimmed } }))
  }
}))

/** Effective channel name — the rename override if present, else the mock name. */
export function useChannelName(channelId: string, fallback: string): string {
  return useChannelStore((state) => state.names[channelId] ?? fallback)
}
