import { Node } from '@tiptap/react'
import { initialsOf } from '@renderer/lib/initials'
import {
  MENTION_GROUPS,
  MENTION_PREFIX,
  parseMentionHref,
  type MentionKind
} from '@renderer/lib/mention'
import type { SuggestionApplyContext, SuggestionEntry } from '@renderer/lib/tiptap-suggestion'

/** An atomic inline pill in the composer. On the way out `docToMarkdown` writes
 *  it as `[@Alice](zinx://user/<id>)`; on the way back in (edit-in-place) that
 *  Markdown becomes an `<a href="zinx://…">`, which `parseHTML` reclaims here. */
export const MentionNode = Node.create({
  name: 'mention',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      kind: { default: 'user' as MentionKind },
      mentionId: { default: '' },
      label: { default: '' }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'a[href]',
        // ProseMirror sorts parse rules by *rule* priority (default 50) and, on a
        // tie, puts every mark rule ahead of every node rule — so without this the
        // link mark would claim `<a href="zinx://…">` and the pill would come back
        // as an ordinary link. Extension priority has no effect here.
        priority: 200,
        getAttrs: (element: HTMLElement) => {
          const parsed = parseMentionHref(element.getAttribute('href'))
          if (!parsed) return false
          return {
            kind: parsed.kind,
            mentionId: parsed.id,
            label: (element.textContent ?? '').replace(/^[@#]/, '')
          }
        }
      },
      {
        tag: 'span[data-mention-kind]',
        getAttrs: (element: HTMLElement) => ({
          kind: element.getAttribute('data-mention-kind'),
          mentionId: element.getAttribute('data-mention-id'),
          label: element.getAttribute('data-mention-label')
        })
      }
    ]
  },

  renderHTML({ node }) {
    const kind = node.attrs.kind as MentionKind
    const label = String(node.attrs.label ?? '')
    return [
      'span',
      {
        class: 'mention-pill',
        'data-mention-kind': kind,
        'data-mention-id': String(node.attrs.mentionId ?? ''),
        'data-mention-label': label
      },
      `${MENTION_PREFIX[kind]}${label}`
    ]
  },

  /** Plain-text copy of the pill (drag/paste out of the editor). */
  renderText({ node }) {
    const kind = node.attrs.kind as MentionKind
    return `${MENTION_PREFIX[kind]}${String(node.attrs.label ?? '')}`
  }
})

// ── Entry builders ───────────────────────────────────────────────────────────

export interface MentionMember {
  id: string
  /** Effective name — the per-workspace nickname if set, else the account name. */
  name: string
  /** Secondary line in the menu (email, or the custom status). */
  subtitle?: string
  color: string
  avatarUrl?: string | null
}

export interface MentionChannel {
  id: string
  name: string
  kind: 'chat' | 'voice' | 'page' | 'kanban'
}

/** Replace the trigger + query with a mention pill, then a trailing space. */
function insertMention(kind: MentionKind, id: string, label: string) {
  return ({ editor, range }: SuggestionApplyContext): void => {
    editor
      .chain()
      .focus()
      .insertContentAt(range, [
        { type: MentionNode.name, attrs: { kind, mentionId: id, label } },
        { type: 'text', text: ' ' }
      ])
      .run()
  }
}

function matches(query: string, ...fields: (string | undefined)[]): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return fields.some((field) => field?.toLowerCase().includes(q))
}

/** `@` — workspace members first, then the role groups (Discord's ordering).
 *  `@everyone` is only offered to owners/admins, mirroring `_zinx`'s mod gate. */
export function userMentionEntries(
  query: string,
  members: MentionMember[],
  options: { canModerate: boolean; limit?: number }
): SuggestionEntry[] {
  const people: SuggestionEntry[] = members
    .filter((member) => matches(query, member.name))
    .slice(0, options.limit ?? 8)
    .map((member) => ({
      id: `user:${member.id}`,
      label: member.name,
      description: member.subtitle,
      group: 'Members',
      avatar: {
        initials: initialsOf(member.name),
        color: member.color,
        image: member.avatarUrl
      },
      apply: insertMention('user', member.id, member.name)
    }))

  const groups: SuggestionEntry[] = MENTION_GROUPS.filter(
    (group) => (!group.moderatorOnly || options.canModerate) && matches(query, group.label)
  ).map((group) => ({
    id: `group:${group.id}`,
    label: group.label,
    description: group.description,
    group: 'Roles',
    icon: 'group' as const,
    apply: insertMention('group', group.id, group.label)
  }))

  return [...people, ...groups]
}

/** `#` — any channel in the workspace, shown with its kind icon (as `zinx-os`
 *  does for its projects/boards/events). */
export function channelMentionEntries(
  query: string,
  channels: MentionChannel[],
  limit = 10
): SuggestionEntry[] {
  return channels
    .filter((channel) => matches(query, channel.name))
    .slice(0, limit)
    .map((channel) => ({
      id: `channel:${channel.id}`,
      label: channel.name,
      description: CHANNEL_KIND_LABEL[channel.kind],
      icon: channel.kind,
      apply: insertMention('channel', channel.id, channel.name)
    }))
}

export const CHANNEL_KIND_LABEL: Record<MentionChannel['kind'], string> = {
  chat: 'Chat channel',
  voice: 'Voice channel',
  page: 'Page',
  kanban: 'Board'
}
