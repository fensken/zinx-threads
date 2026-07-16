import { create } from 'zustand'

function readNum(key: string, fallback: number): number {
  const value = Number(localStorage.getItem(key))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

const MEMBERS_KEY = 'zinx-members-open'
const SIDEBAR_COLLAPSED_KEY = 'zinx-sidebar-collapsed'

/** The channel sidebar is shown by default; a user can collapse it (desktop) and
 *  the choice persists across sessions. */
function readSidebarCollapsed(): boolean {
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
}

/** Remembered across sessions; when unset, default to open on desktop-width
 *  windows (lg+) and closed on narrow ones (where it's an overlay). */
function readMemberListOpen(): boolean {
  const stored = localStorage.getItem(MEMBERS_KEY)
  if (stored === '1') return true
  if (stored === '0') return false
  return typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
}

function persistMemberListOpen(open: boolean): void {
  localStorage.setItem(MEMBERS_KEY, open ? '1' : '0')
}

/** Sections of the unified Settings modal (user + workspace). */
export type SettingsSection =
  | 'account'
  | 'appearance'
  | 'notifications'
  | 'startup'
  | 'developers'
  | 'advanced'
  | 'ws-profile'
  | 'ws-general'
  | 'ws-members'
  | 'ws-bots'
  | 'ws-danger'

interface UiState {
  sidebarCollapsed: boolean
  memberListOpen: boolean
  activeThreadId: string | null
  replyingToId: string | null
  inboxOpen: boolean
  settingsOpen: boolean
  settingsSection: SettingsSection
  threadsOpen: boolean
  eventsOpen: boolean
  /** Pinned-messages dialog: opened from the channel header, rendered by the chat view. */
  pinnedOpen: boolean
  paletteOpen: boolean
  navOpen: boolean
  sidebarWidth: number
  rightWidth: number
  threadWidth: number
  toggleSidebar: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
  toggleMemberList: () => void
  setMemberListOpen: (open: boolean) => void
  openThread: (id: string) => void
  closeThread: () => void
  setReplyingTo: (id: string | null) => void
  setInboxOpen: (open: boolean) => void
  setSettingsOpen: (open: boolean) => void
  openSettings: (section?: SettingsSection) => void
  setSettingsSection: (section: SettingsSection) => void
  setThreadsOpen: (open: boolean) => void
  setEventsOpen: (open: boolean) => void
  setPinnedOpen: (open: boolean) => void
  setPaletteOpen: (open: boolean) => void
  togglePalette: () => void
  setNavOpen: (open: boolean) => void
  setSidebarWidth: (width: number) => void
  setRightWidth: (width: number) => void
  setThreadWidth: (width: number) => void
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: readSidebarCollapsed(),
  // Remembered across sessions; defaults to open on lg+ (the inline column) and
  // closed below lg, where it's an overlay that would otherwise pop over content.
  memberListOpen: readMemberListOpen(),
  activeThreadId: null,
  replyingToId: null,
  inboxOpen: false,
  settingsOpen: false,
  settingsSection: 'account',
  threadsOpen: false,
  eventsOpen: false,
  pinnedOpen: false,
  paletteOpen: false,
  navOpen: false,
  sidebarWidth: clamp(readNum('zinx-sidebar-w', 272), 220, 340),
  rightWidth: readNum('zinx-right-w', 256),
  threadWidth: readNum('zinx-thread-w', 420),
  toggleSidebar: () =>
    set((state) => {
      const next = !state.sidebarCollapsed
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
      return { sidebarCollapsed: next }
    }),
  setSidebarCollapsed: (collapsed) => {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
    set({ sidebarCollapsed: collapsed })
  },
  // Only one right panel at a time: toggling members closes any open thread.
  toggleMemberList: () =>
    set((state) => {
      const next = state.activeThreadId ? true : !state.memberListOpen
      persistMemberListOpen(next)
      return state.activeThreadId
        ? { activeThreadId: null, memberListOpen: true }
        : { memberListOpen: next }
    }),
  setMemberListOpen: (open) => {
    persistMemberListOpen(open)
    set({ memberListOpen: open })
  },
  // Opening a thread takes over the right panel; the member-list preference is
  // preserved and re-shown when the thread is closed.
  openThread: (id) => set({ activeThreadId: id, threadsOpen: false }),
  closeThread: () => set({ activeThreadId: null }),
  setReplyingTo: (id) => set({ replyingToId: id }),
  setInboxOpen: (open) => set({ inboxOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  openSettings: (section) =>
    set(section ? { settingsOpen: true, settingsSection: section } : { settingsOpen: true }),
  setSettingsSection: (section) => set({ settingsSection: section }),
  setThreadsOpen: (open) => set({ threadsOpen: open }),
  setEventsOpen: (open) => set({ eventsOpen: open }),
  setPinnedOpen: (open) => set({ pinnedOpen: open }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen })),
  setNavOpen: (open) => set({ navOpen: open }),
  setSidebarWidth: (width) => {
    const next = clamp(width, 220, 340)
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
