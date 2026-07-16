/** A DM has no name of its own — it's *the people in it*. The channel row's `name`
 *  is an internal key (`dm-<participant ids>`) and must never be rendered, so every
 *  surface that shows a conversation derives its title from the participants here.
 *  One person → their name; a group → the names, comma-joined. */

export interface DmPerson {
  name: string
  color?: string
  avatarUrl?: string
}

export function dmTitle(others: DmPerson[]): string {
  if (others.length === 0) return 'Just you'
  return others.map((person) => person.name).join(', ')
}

/** Initials for the row's avatar: the one person's, or the first two of a group. */
export function dmInitials(others: DmPerson[]): string {
  const first = others[0]
  if (!first) return '?'
  const parts = first.name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
