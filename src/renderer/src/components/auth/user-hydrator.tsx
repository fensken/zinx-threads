import { useEffect } from 'react'
import { useMutation } from 'convex/react'
import { api } from '@convex/_generated/api'
import { useAppAuth } from '@renderer/lib/use-app-auth'

/** Upserts the signed-in WorkOS user into the Convex `users` table (idempotent).
 *  Rendered only inside <Authenticated>, so `useAppAuth` + the mutation are safe. */
export function UserHydrator(): null {
  const { user } = useAppAuth()
  const store = useMutation(api.users.store)

  useEffect(() => {
    if (!user?.email) return
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ')
    void store({
      email: user.email,
      name: name || undefined,
      avatarUrl: user.profilePictureUrl ?? undefined
    })
  }, [user?.email, user?.firstName, user?.lastName, user?.profilePictureUrl, store])

  return null
}
