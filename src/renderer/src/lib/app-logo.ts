import logoSrc from '@renderer/assets/logo.png'

/**
 * The app's brand mark as a URL (the in-app `assets/logo.png`, resized by
 * `scripts/generate-icon.mjs`). Used as the fallback image where a colored-initials placeholder
 * would otherwise show but the brand reads better: a workspace with no logo/icon, and a **bot**
 * (which has no photo of its own). Imported as a module so the URL resolves under the packaged
 * `file://` renderer.
 */
export const APP_LOGO_SRC: string = logoSrc

/**
 * The image to render for an avatar: the user's own photo if they have one, otherwise the app logo
 * for a bot (bots have no photo), otherwise nothing (falls through to the colored-initials avatar).
 */
export function avatarImageFor(
  avatarUrl?: string | null,
  isBot?: boolean
): string | null | undefined {
  if (avatarUrl) return avatarUrl
  return isBot ? APP_LOGO_SRC : avatarUrl
}
