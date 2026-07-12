/** Avatar presence-dot state: online→green, idle→amber, dnd→red, offline→grey. */
export type Presence = 'online' | 'idle' | 'dnd' | 'offline'

/** User-set presence (Discord/Slack-style). Distinct from the avatar-dot `Presence`
 *  above — map with `presenceForStatus`. */
export type UserStatus = 'online' | 'away' | 'dnd' | 'invisible'

export const USER_STATUSES: {
  id: UserStatus
  label: string
  description?: string
}[] = [
  { id: 'online', label: 'Online' },
  { id: 'away', label: 'Away' },
  { id: 'dnd', label: 'Do Not Disturb', description: 'You will not receive notifications.' },
  { id: 'invisible', label: 'Invisible', description: 'You will appear offline.' }
]

export const STATUS_LABEL: Record<UserStatus, string> = {
  online: 'Online',
  away: 'Away',
  dnd: 'Do Not Disturb',
  invisible: 'Invisible'
}

/** A signed-in user with no stored presence is treated as online. */
export function normalizeStatus(status: string | null | undefined): UserStatus {
  return status === 'away' || status === 'dnd' || status === 'invisible' ? status : 'online'
}

/** Map a user status to the avatar presence dot (online→green, away→amber,
 *  dnd→red, invisible→grey/offline). */
export function presenceForStatus(status: string | null | undefined): Presence {
  switch (normalizeStatus(status)) {
    case 'away':
      return 'idle'
    case 'dnd':
      return 'dnd'
    case 'invisible':
      return 'offline'
    default:
      return 'online'
  }
}

/** Fold live connectivity (from the presence component) into the displayed dot.
 *  `isOnline` (see `presence-store` `useIsOnline`):
 *  - `false` → the app is closed/backgrounded → **offline**, whatever they last set.
 *  - `undefined` (presence not loaded) or `true` → show their manual status
 *    (`Invisible` still reads offline). So a user who set "Away" then quit reads
 *    offline; on reopen they read "Away" again. */
export function presenceWithConnectivity(
  status: string | null | undefined,
  isOnline: boolean | undefined
): Presence {
  if (isOnline === false) return 'offline'
  return presenceForStatus(status)
}
