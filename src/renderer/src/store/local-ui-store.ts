import { create } from 'zustand'

/** Which pane the offline settings dialog opens to. Mirrors the online settings
 *  sections, minus the online-only ones (members, per-workspace nickname, etc.). */
export type LocalSettingsSection =
  'profile' | 'appearance' | 'notifications' | 'startup' | 'workspace' | 'danger'

/** Ephemeral UI state for the offline shell (NOT persisted). */
interface LocalUiStore {
  settingsOpen: boolean
  settingsSection: LocalSettingsSection
  openSettings: (section: LocalSettingsSection) => void
  setSettingsOpen: (open: boolean) => void
  /** The ⌘K command palette — the SAME modal the online app uses (see
   *  `local-command-palette.tsx`). Search opens it instead of an inline field. */
  paletteOpen: boolean
  setPaletteOpen: (open: boolean) => void
  togglePalette: () => void
}

export const useLocalUiStore = create<LocalUiStore>((set) => ({
  settingsOpen: false,
  settingsSection: 'profile',
  openSettings: (section) => set({ settingsOpen: true, settingsSection: section }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  paletteOpen: false,
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  togglePalette: () => set((state) => ({ paletteOpen: !state.paletteOpen }))
}))
