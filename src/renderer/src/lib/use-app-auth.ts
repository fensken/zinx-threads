/**
 * One auth interface, two implementations chosen at load time:
 *  • Desktop (Electron): the MAIN-process WorkOS flow over IPC (lib/desktop-auth.ts) —
 *    tokens in an OS-keychain vault, in-app login window. No authkit-react.
 *  • Web: authkit-react's `useAuth` — a genuine browser SPA, the right tool there.
 *
 * The target is a stable module constant, so `useAppAuth` swaps the WHOLE hook (never a
 * conditional hook call — that would break the rules of hooks). Components read
 * `{ user, isLoading, signIn, signOut }`; Convex gets its token via `useConvexDesktopAuth`
 * (desktop) or `ConvexProviderWithAuthKit` (web). Mirrors the platform.ts split.
 */
import { useCallback } from 'react'
import { useAuth as useWorkosAuth } from '@workos-inc/authkit-react'
import { isElectron } from './platform'
import { desktopAuth, useDesktopAuthState } from './desktop-auth'

/** The signed-in user (camelCase, matching authkit-react's `user`). */
export interface AuthUser {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  profilePictureUrl: string | null
}

export interface AppAuth {
  user: AuthUser | null
  isLoading: boolean
  signIn: () => void
  signOut: () => void
}

const isDesktopAuth = isElectron

function useDesktopAppAuth(): AppAuth {
  const { isLoading, user } = useDesktopAuthState()
  return { user, isLoading, signIn: desktopAuth.signIn, signOut: desktopAuth.signOut }
}

function useWebAppAuth(): AppAuth {
  const { user, isLoading, signIn, signOut } = useWorkosAuth()
  return {
    user: user
      ? {
          id: user.id,
          email: user.email ?? '',
          firstName: user.firstName ?? null,
          lastName: user.lastName ?? null,
          profilePictureUrl: user.profilePictureUrl ?? null
        }
      : null,
    isLoading,
    signIn: () => void signIn(),
    signOut: () => void signOut()
  }
}

/** The app-wide auth hook — same shape on web and desktop. */
export const useAppAuth: () => AppAuth = isDesktopAuth ? useDesktopAppAuth : useWebAppAuth

/** `useAuth` for `ConvexProviderWithAuth` on desktop — feeds Convex the main-process
 *  access token (main refreshes on demand). */
export function useConvexDesktopAuth(): {
  isLoading: boolean
  isAuthenticated: boolean
  fetchAccessToken: (options: { forceRefreshToken: boolean }) => Promise<string | null>
} {
  const { isLoading, isAuthenticated } = useDesktopAuthState()
  const fetchAccessToken = useCallback(
    ({ forceRefreshToken }: { forceRefreshToken: boolean }) =>
      desktopAuth.getToken(forceRefreshToken),
    []
  )
  return { isLoading, isAuthenticated, fetchAccessToken }
}
