import { useSyncExternalStore } from 'react'
import { useThemeStore } from '@renderer/store/theme-store'

const DARK_QUERY = '(prefers-color-scheme: dark)'

function subscribePrefersDark(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/** Is the app currently dark? — the *resolved* theme, with `system` followed live.
 *
 *  Third-party editors (BlockNote, Excalidraw) render their own palettes and need to
 *  be told which one; they can't read our CSS variables. Derived, with no effect: the
 *  store's theme plus a subscription to the OS preference. */
export function useIsDark(): boolean {
  const theme = useThemeStore((state) => state.theme)
  const prefersDark = useSyncExternalStore(
    subscribePrefersDark,
    () => window.matchMedia(DARK_QUERY).matches
  )
  return theme === 'dark' || (theme === 'system' && prefersDark)
}
