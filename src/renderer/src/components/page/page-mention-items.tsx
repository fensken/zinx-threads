import { Megaphone, ShieldStar } from '@phosphor-icons/react'
import {
  type DirectoryChannel,
  type DirectoryMember
} from '@renderer/components/chat/workspace-directory-context'
import { ChannelKindIcon } from '@renderer/components/chat/channel-kind-icon'
import { Avatar, FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import { avatarImageFor } from '@renderer/lib/app-logo'
import { MENTION_GROUPS } from '@renderer/lib/mention'

/**
 * Item builders for the page `@`/`#` autocomplete menu — split out of `page-mentions.tsx`
 * (which owns the menu **component**) so that file stays a clean react-refresh boundary
 * (components only). These are plain factories that produce a `PageSuggestionItem`; the
 * menu component (`PageSuggestionMenu`) renders them to look exactly like the chat composer's
 * popup — avatar for a person, kind icon for a channel, role glyph for a group — grouped into
 * Members / Roles sections exactly like chat's `@` (`lib/tiptap-mention.ts` `userMentionEntries`).
 *
 * Deliberately NO `@silent`: that's a *send* directive (a message posted without notifying
 * anyone), and a page isn't sent — offering it here would be a dead affordance.
 */

/** Human label for a channel kind — the menu subtext, matching chat's `CHANNEL_KIND_LABEL`. */
const CHANNEL_KIND_LABEL: Record<DirectoryChannel['kind'], string> = {
  chat: 'Chat channel',
  voice: 'Voice channel',
  page: 'Page',
  kanban: 'Board',
  whiteboard: 'Whiteboard'
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** What the `@`/`#` menu inserts — the same `mention` inline atom, tagged by kind. */
export interface MentionInsert {
  id: string
  label: string
  kind: 'user' | 'channel' | 'group'
}

/** One row in the page `@`/`#` menu. `glyph` is the pre-rendered avatar / kind icon,
 *  so the menu component stays presentational. `title`/`aliases` feed BlockNote's
 *  `filterSuggestionItems`; `group` draws the section header (entries are pre-ordered). */
export interface PageSuggestionItem {
  title: string
  subtext?: string
  aliases?: string[]
  group?: string
  glyph: React.ReactNode
  onItemClick: () => void
}

/** `@member` row — avatar (photo → app logo for a bot → colored initials) + name + email. */
export function memberSuggestionItem(
  member: DirectoryMember,
  insert: (mention: MentionInsert) => void
): PageSuggestionItem {
  return {
    title: member.name,
    subtext: member.email,
    aliases: member.email ? [member.email] : undefined,
    group: 'Members',
    glyph: (
      <Avatar
        initials={initialsOf(member.name)}
        color={member.color ?? FALLBACK_AVATAR_COLOR}
        image={avatarImageFor(member.avatarUrl, member.isBot)}
        className="size-6 text-[10px]"
      />
    ),
    onItemClick: () => insert({ id: member.userId, label: member.name, kind: 'user' })
  }
}

/** Role rows — `@everyone` (owner/admin only, mirroring chat's mod gate) + `@admins`. Each
 *  inserts a `group` mention that renders as an amber role pill, exactly like chat. */
export function roleSuggestionItems(
  canModerate: boolean,
  insert: (mention: MentionInsert) => void
): PageSuggestionItem[] {
  return MENTION_GROUPS.filter((group) => !group.moderatorOnly || canModerate).map((group) => ({
    title: group.label,
    subtext: group.description,
    group: 'Roles',
    glyph:
      group.id === 'everyone' ? (
        <Megaphone className="size-5 shrink-0 text-muted-foreground" weight="fill" />
      ) : (
        <ShieldStar className="size-5 shrink-0 text-muted-foreground" weight="fill" />
      ),
    onItemClick: () => insert({ id: group.id, label: group.label, kind: 'group' })
  }))
}

/** `#channel` row — the channel's kind icon + its name + a kind label (as chat's `#` does). */
export function channelSuggestionItem(
  channel: DirectoryChannel,
  insert: (mention: MentionInsert) => void
): PageSuggestionItem {
  return {
    title: channel.name,
    subtext: CHANNEL_KIND_LABEL[channel.kind],
    glyph: (
      <ChannelKindIcon kind={channel.kind} className="size-5 shrink-0 text-muted-foreground" />
    ),
    onItemClick: () => insert({ id: channel.id, label: channel.name, kind: 'channel' })
  }
}
