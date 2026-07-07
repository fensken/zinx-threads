import { create } from 'zustand'

/** Whole-UI scale. Applied as the root font-size, so every rem-based size
 *  (text, spacing, icons, radii) zooms proportionally. */
export type UiScale = 'xs' | 'sm' | 'md' | 'lg'

const STORAGE_KEY = 'zinx-ui-scale'
const DEFAULT_SCALE: UiScale = 'md'
const RAIL_KEY = 'zinx-server-rail'

const ROOT_PX: Record<UiScale, string> = {
  xs: '12px',
  sm: '14px',
  md: '16px',
  lg: '18px'
}

function readStored(): UiScale {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'xs' || stored === 'sm' || stored === 'md' || stored === 'lg'
    ? stored
    : DEFAULT_SCALE
}

function applyScale(scale: UiScale): void {
  document.documentElement.style.fontSize = ROOT_PX[scale]
}

interface SettingsState {
  uiScale: UiScale
  setUiScale: (scale: UiScale) => void
  /** Show workspaces as a Discord-style left rail (opt-in); else just the dropdown. */
  showServerRail: boolean
  setShowServerRail: (show: boolean) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  uiScale: readStored(),
  setUiScale: (uiScale) => {
    localStorage.setItem(STORAGE_KEY, uiScale)
    applyScale(uiScale)
    set({ uiScale })
  },
  showServerRail: localStorage.getItem(RAIL_KEY) === '1',
  setShowServerRail: (show) => {
    localStorage.setItem(RAIL_KEY, show ? '1' : '0')
    set({ showServerRail: show })
  }
}))

// Apply before first render (imported early in main.tsx).
applyScale(useSettingsStore.getState().uiScale)
