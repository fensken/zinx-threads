import { create } from 'zustand'

function readNum(key: string, fallback: number): number {
  const value = Number(localStorage.getItem(key))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

interface UiState {
  memberListOpen: boolean
  activeThreadId: string | null
  replyingToId: string | null
  inboxOpen: boolean
  settingsOpen: boolean
  threadsOpen: boolean
  paletteOpen: boolean
  navOpen: boolean
  sidebarWidth: number
  rightWidth: number
  threadWidth: number
  toggleMemberList: () => void
  openThread: (id: string) => void
  closeThread: () => void
  setReplyingTo: (id: string | null) => void
  setInboxOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  setThreadsOpen: (open: boolean) => void
  setPaletteOpen: (open: boolean) => void
  togglePalette: () => void
  setNavOpen: (open: boolean) => void
  setSidebarWidth: (width: number) => void
  setRightWidth: (width: number) => void
  setThreadWidth: (width: number) => void
}

export const useUiStore = create<UiState>((set) => ({
  memberListOpen: true,
  activeThreadId: null,
  replyingToId: null,
  inboxOpen: false,
  settingsOpen: false,
  threadsOpen: false,
  paletteOpen: false,
  navOpen: false,
  sidebarWidth: readNum('zinx-sidebar-w', 272),
  rightWidth: readNum('zinx-right-w', 256),
  threadWidth: readNum('zinx-thread-w', 420),
  // Only one right panel at a time: toggling members closes any open thread.
  toggleMemberList: () =>
    set((state) =>
      state.activeThreadId
        ? { activeThreadId: null, memberListOpen: true }
        : { memberListOpen: !state.memberListOpen }
    ),
  // Opening a thread takes over the right panel; the member-list preference is
  // preserved and re-shown when the thread is closed.
  openThread: (id) => set({ activeThreadId: id, threadsOpen: false }),
  closeThread: () => set({ activeThreadId: null }),
  setReplyingTo: (id) => set({ replyingToId: id }),
  setInboxOpen: (open) => set({ inboxOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setThreadsOpen: (open) => set({ threadsOpen: open }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen })),
  setNavOpen: (open) => set({ navOpen: open }),
  setSidebarWidth: (width) => {
    const next = clamp(width, 220, 440)
    localStorage.setItem('zinx-sidebar-w', String(next))
    set({ sidebarWidth: next })
  },
  setRightWidth: (width) => {
    const next = clamp(width, 220, 480)
    localStorage.setItem('zinx-right-w', String(next))
    set({ rightWidth: next })
  },
  setThreadWidth: (width) => {
    const next = clamp(width, 320, 640)
    localStorage.setItem('zinx-thread-w', String(next))
    set({ threadWidth: next })
  }
}))
