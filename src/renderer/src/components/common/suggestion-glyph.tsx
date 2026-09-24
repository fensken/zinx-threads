import { BellSlash, ShieldStar } from '@phosphor-icons/react'
import { Avatar } from '@renderer/components/common/avatar'
import { ChannelKindIcon } from '@renderer/components/chat/channel-kind-icon'
import type { SuggestionEntry } from '@renderer/lib/tiptap-suggestion'
import { cn } from '@renderer/lib/utils'

/**
 * The left-hand visual of one autocomplete row — shared by the chat composer's menu and
 * the doc editor's, so a `@person` or a `#channel` reads identically in both.
 *
 * Four cases, in precedence order: an avatar (people), an already-rendered `iconNode` (the
 * doc's block menu, whose vocabulary is far bigger than the icon-token set), a token from
 * `SuggestionIcon`, or nothing.
 */
export function SuggestionGlyph({
  entry,
  className,
  avatarClassName
}: {
  entry: SuggestionEntry
  /** Sizing for the ICON cases. */
  className?: string
  /** Sizing for the AVATAR case — a person's face reads better a size up than a glyph,
   *  so the two aren't the same number in either menu. */
  avatarClassName?: string
}): React.JSX.Element | null {
  const iconClass = cn('shrink-0 text-muted-foreground', className ?? 'size-5')

  if (entry.avatar) {
    return (
      <Avatar
        initials={entry.avatar.initials}
        color={entry.avatar.color}
        image={entry.avatar.image}
        className={cn('text-[10px]', avatarClassName ?? 'size-6')}
      />
    )
  }
  if (entry.iconNode) {
    return (
      <span className={cn('flex items-center justify-center', iconClass)}>{entry.iconNode}</span>
    )
  }
  if (entry.icon === 'group') return <ShieldStar className={iconClass} weight="fill" />
  if (entry.icon === 'silent') return <BellSlash className={iconClass} weight="fill" />
  if (entry.icon) return <ChannelKindIcon kind={entry.icon} className={iconClass} />
  return null
}
