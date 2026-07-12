/** Mentions live inside the Markdown body as ordinary links with a private
 *  scheme: `[@Alice](zinx://user/<id>)`, `[#general](zinx://channel/<id>)`,
 *  `[@everyone](zinx://group/everyone)`.
 *
 *  `_zinx`/`zinx-os` store Discord-style tokens (`<@id>`) and rewrite them with a
 *  custom renderer plugin. Encoding them as *links* instead means every consumer
 *  we already have keeps working unchanged: `messagePreview()` strips links to
 *  their text, `markdownToHtml()` round-trips them for edit-in-place, and the
 *  renderer just branches inside its existing `a` component. No raw-HTML plugin,
 *  so user content still can't inject markup.
 *
 *  The embedded label is only a fallback — the workspace directory resolves the
 *  *current* name at render time, so renaming a user or channel updates old
 *  messages. The id is never displayed. */

export type MentionKind = 'user' | 'channel' | 'group'

const SCHEME = 'zinx://'
// Convex ids are URL-safe base32-ish; group ids are our own literals.
const HREF_RE = /^zinx:\/\/(user|channel|group)\/([A-Za-z0-9_-]+)$/

export const MENTION_PREFIX: Record<MentionKind, string> = {
  user: '@',
  channel: '#',
  group: '@'
}

export function mentionHref(kind: MentionKind, id: string): string {
  return `${SCHEME}${kind}/${id}`
}

export function parseMentionHref(
  href: string | null | undefined
): { kind: MentionKind; id: string } | null {
  if (!href) return null
  const match = HREF_RE.exec(href)
  return match ? { kind: match[1] as MentionKind, id: match[2] } : null
}

export function isMentionHref(href: string | null | undefined): boolean {
  return parseMentionHref(href) !== null
}

const MENTION_LINK_RE = /\[([^\]]+)\]\(zinx:\/\/(?:user|channel|group)\/[A-Za-z0-9_-]+\)/g

/** Collapse mention links back to their labels (`[@Alice](zinx://user/x)` →
 *  `@Alice`). Used when copying a message: the clipboard should carry what the
 *  reader saw, never an internal id. */
export function stripMentionLinks(markdown: string): string {
  return markdown.replace(MENTION_LINK_RE, '$1')
}

// ── Group ("role") mentions ──────────────────────────────────────────────────
// Our workspaces have exactly three roles (owner/admin/member), so rather than a
// role table we expose two well-known groups. `@everyone` is moderator-gated the
// way Discord gates it; `@admins` is open so any member can escalate.

export type MentionGroupId = 'everyone' | 'admins'

export interface MentionGroup {
  id: MentionGroupId
  label: string
  description: string
  /** Only owners/admins may insert it. */
  moderatorOnly: boolean
}

export const MENTION_GROUPS: MentionGroup[] = [
  {
    id: 'everyone',
    label: 'everyone',
    description: 'Notify every member of this workspace',
    moderatorOnly: true
  },
  {
    id: 'admins',
    label: 'admins',
    description: 'Notify the owner and admins',
    moderatorOnly: false
  }
]

export function mentionGroup(id: string): MentionGroup | undefined {
  return MENTION_GROUPS.find((group) => group.id === id)
}
