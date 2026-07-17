import { useEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { At, Megaphone, ShieldStar } from '@phosphor-icons/react'
import { createReactInlineContentSpec, type SuggestionMenuProps } from '@blocknote/react'
import { useWorkspaceDirectory } from '@renderer/components/chat/workspace-directory-context'
import { ChannelKindIcon } from '@renderer/components/chat/channel-kind-icon'
import { UserProfilePopover } from '@renderer/components/chat/user-profile-popover'
import { FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import type { PageSuggestionItem } from '@renderer/components/page/page-mention-items'
import { mentionGroup } from '@renderer/lib/mention'
import { cn } from '@renderer/lib/utils'

/**
 * `@user` / `#channel` mentions inside a page, the same idea as the chat composer — but the
 * page runs on **BlockNote** (not the TipTap chat editor), so this is a BlockNote **inline
 * content** spec + two `SuggestionMenuController`s (in `page-editor.tsx`), fed by the same
 * `WorkspaceDirectory` chat uses.
 *
 * The mention stores an `id` + a fallback `label`; the pill resolves the **current** name from
 * the directory at render (so renames update old mentions), exactly like chat's mention pills.
 * A user pill opens the profile card; a channel pill navigates. Outside a workspace (the
 * offline `/local` page), the directory is null → the pill is inert styled text.
 */

/** `#channel` — resolves the current name; clicking navigates to the channel. Shows the
 *  channel's **kind icon** (chat/voice/page/kanban/whiteboard) exactly like the chat pill;
 *  an unresolved channel (deleted, or the offline `/local` page) falls back to a muted
 *  `#name` chip rather than a broken link — same as `MentionPill`. */
function ChannelPill({ id, label }: { id: string; label: string }): React.JSX.Element {
  const directory = useWorkspaceDirectory()
  const navigate = useNavigate()
  const channel = directory?.channelById(id)
  const name = channel?.name ?? label
  if (!directory || !channel) {
    return (
      <span className="zinx-mention zinx-mention-unknown" contentEditable={false}>
        #{name}
      </span>
    )
  }
  return (
    <span
      className="zinx-mention zinx-mention-channel"
      contentEditable={false}
      onClick={() =>
        void navigate({
          to: '/w/$workspaceId/$channelSlug',
          params: { workspaceId: directory.slug, channelSlug: channel.name }
        })
      }
    >
      <ChannelKindIcon kind={channel.kind} />
      {name}
    </span>
  )
}

/** `@user` — resolves the current name; opens the profile card (like chat). Leads with an
 *  `@` glyph so it reads the same as the chat mention pill. */
function UserPill({ id, label }: { id: string; label: string }): React.JSX.Element {
  const directory = useWorkspaceDirectory()
  const member = directory?.memberById(id)
  const name = member?.name ?? label
  const pill = (
    <span className="zinx-mention zinx-mention-user" contentEditable={false}>
      <At weight="bold" />
      {name}
    </span>
  )
  if (!directory || !member) return pill
  return (
    <UserProfilePopover
      userId={id}
      fallbackName={name}
      fallbackColor={member.color ?? FALLBACK_AVATAR_COLOR}
      fallbackAvatarUrl={member.avatarUrl}
    >
      {pill}
    </UserProfilePopover>
  )
}

/** `@everyone` / `@admins` — a role mention. Amber, with a megaphone/shield glyph, exactly
 *  like chat's role pill (`MentionPill`). Resolves the group's canonical label. */
function GroupPill({ id, label }: { id: string; label: string }): React.JSX.Element {
  const group = mentionGroup(id)
  const name = group?.label ?? label
  return (
    <span className="zinx-mention zinx-mention-role" contentEditable={false}>
      {id === 'everyone' ? <Megaphone weight="fill" /> : <ShieldStar weight="fill" />}@{name}
    </span>
  )
}

// ── Autocomplete menu (`@` people / `#` channels) ─────────────────────────────
// The page runs on BlockNote, but the `@`/`#` menus are rendered to look EXACTLY like
// the chat composer's (`chat/chat-composer.tsx` `SuggestionMenuList`): an avatar for a
// person, a channel-kind icon for a channel, a bold label + muted subtext — instead of
// BlockNote's default (icon-less, blue-selection) suggestion menu. The item builders live
// in `page-mention-items.tsx` (this file stays a components-only react-refresh boundary).

/** The custom BlockNote `suggestionMenuComponent` for `@`/`#`. BlockNote positions it
 *  (floating) and owns keyboard nav via `selectedIndex`; we own the look — one that
 *  matches the chat composer's popup exactly. */
export function PageSuggestionMenu({
  items,
  selectedIndex,
  onItemClick
}: SuggestionMenuProps<PageSuggestionItem>): React.JSX.Element {
  const activeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  return (
    <div className="no-scrollbar max-h-72 w-72 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-lg border bg-popover p-1 shadow-xl">
      {items.length === 0 ? (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">No matches</p>
      ) : (
        items.map((item, index) => {
          // Entries arrive pre-grouped (Members → Roles), so a header is simply
          // "this row's group differs from the previous row's" — like chat's menu.
          const header = item.group && item.group !== items[index - 1]?.group ? item.group : null
          return (
            <div key={`${item.title}-${index}`}>
              {header ? (
                <p className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {header}
                </p>
              ) : null}
              <button
                ref={index === selectedIndex ? activeRef : null}
                type="button"
                // Keep the editor selection — the caret must survive the click.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onItemClick?.(item)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                  index === selectedIndex ? 'bg-accent' : 'hover:bg-accent'
                )}
              >
                {item.glyph}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-popover-foreground">
                    {item.title}
                  </span>
                  {item.subtext ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.subtext}
                    </span>
                  ) : null}
                </span>
              </button>
            </div>
          )
        })
      )}
    </div>
  )
}

/** The BlockNote inline-content spec — added to the schema's `inlineContentSpecs`. */
export const MentionInline = createReactInlineContentSpec(
  {
    type: 'mention',
    propSchema: {
      id: { default: '' },
      label: { default: '' },
      kind: { default: 'user' }
    },
    content: 'none'
  },
  {
    render: ({ inlineContent }): React.JSX.Element => {
      const { id, label, kind } = inlineContent.props
      if (kind === 'channel') return <ChannelPill id={id} label={label} />
      if (kind === 'group') return <GroupPill id={id} label={label} />
      return <UserPill id={id} label={label} />
    }
  }
)
