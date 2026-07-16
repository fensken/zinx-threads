import { create } from 'zustand'

/** Whole-UI scale. Applied as the root font-size, so every rem-based size
 *  (text, spacing, icons, radii) zooms proportionally. */
export type UiScale = 'xs' | 'sm' | 'md' | 'lg'

const STORAGE_KEY = 'zinx-ui-scale'
const DEFAULT_SCALE: UiScale = 'md'
const COMPOSER_KEY = 'zinx-composer-expanded'
const SOUND_KEY = 'zinx-sound-enabled'
const VOLUME_KEY = 'zinx-sound-volume'
const DESKTOP_NOTIF_KEY = 'zinx-desktop-notifications'

/** Default 0.7 — the sounds are designed to be gentle, so this is "clearly audible"
 *  rather than "loud". */
function readVolume(): number {
  const stored = Number(localStorage.getItem(VOLUME_KEY))
  return Number.isFinite(stored) && stored >= 0 && stored <= 1 ? stored : 0.7
}

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
  /** Chat composer shows its formatting toolbar. Compact (false) by default. */
  composerExpanded: boolean
  setComposerExpanded: (expanded: boolean) => void
  /** Master switch for every sound the app makes (messages + call events). A sound
   *  you can't turn off is hostile, so this exists from the start. */
  soundEnabled: boolean
  setSoundEnabled: (enabled: boolean) => void
  /** 0–1. Scales every sound; `lib/sounds.ts` reads it at play time. */
  soundVolume: number
  setSoundVolume: (volume: number) => void
  /** Desktop OS notifications while the window is in the background. */
  desktopNotifications: boolean
  setDesktopNotifications: (enabled: boolean) => void
}

function readBool(key: string, fallback: boolean): boolean {
  const stored = localStorage.getItem(key)
  if (stored === null) return fallback
  return stored === '1'
}

export const useSettingsStore = create<SettingsState>((set) => ({
  uiScale: readStored(),
  setUiScale: (uiScale) => {
    localStorage.setItem(STORAGE_KEY, uiScale)
    applyScale(uiScale)
    set({ uiScale })
  },
  composerExpanded: localStorage.getItem(COMPOSER_KEY) === '1',
  setComposerExpanded: (expanded) => {
    localStorage.setItem(COMPOSER_KEY, expanded ? '1' : '0')
    set({ composerExpanded: expanded })
  },
  soundEnabled: readBool(SOUND_KEY, true),
  setSoundEnabled: (soundEnabled) => {
    localStorage.setItem(SOUND_KEY, soundEnabled ? '1' : '0')
    set({ soundEnabled })
  },
  soundVolume: readVolume(),
  setSoundVolume: (volume) => {
    const soundVolume = Math.min(Math.max(volume, 0), 1)
    localStorage.setItem(VOLUME_KEY, String(soundVolume))
    set({ soundVolume })
  },
  desktopNotifications: readBool(DESKTOP_NOTIF_KEY, true),
  setDesktopNotifications: (desktopNotifications) => {
    localStorage.setItem(DESKTOP_NOTIF_KEY, desktopNotifications ? '1' : '0')
    set({ desktopNotifications })
  }
}))

// Apply before first render (imported early in main.tsx).
applyScale(useSettingsStore.getState().uiScale)
