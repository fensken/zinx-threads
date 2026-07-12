import { useAppAuth } from './use-app-auth'

/**
 * Sign-in / sign-out actions. Thin wrapper over `useAppAuth` (kept for the callers that
 * only need the actions). On desktop these drive the main-process WorkOS flow (in-app
 * login window); on web they drive authkit-react. See use-app-auth.ts.
 */
export function useAuthActions(): { signIn: () => void; signOut: () => void } {
  const { signIn, signOut } = useAppAuth()
  return { signIn, signOut }
}
