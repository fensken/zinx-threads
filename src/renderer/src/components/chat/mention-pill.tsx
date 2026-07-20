import { useNavigate } from '@tanstack/react-router'
import { At, BellSlash, Megaphone, ShieldStar } from '@phosphor-icons/react'
import { ChannelKindIcon } from '@renderer/components/chat/channel-kind-icon'
import { UserProfilePopover } from '@renderer/components/chat/user-profile-popover'
import { useWorkspaceDirectory } from '@renderer/components/chat/workspace-directory-context'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { mentionGroup, parseMentionHref } from '@renderer/lib/mention'
import { cn } from '@renderer/lib/utils'

const PILL =
  'mx-px inline-flex items-center gap-0.5 rounded px-1 py-px align-baseline text-[0.95em] font-medium transition-colors'

/** A rendered `@user`, `@role` or `#channel` inside a message body.
 *
 *  The label is resolved from the live workspace directory, so a rename updates
 *  every historical message; the label baked into the Markdown is only the
 *  fallback (and what a plain-text copy of the message shows). */
export function MentionPill({
  href,
  fallbackLabel
}: {
  href: string
  fallbackLabel: string
}): React.JSX.Element {
  const directory = useWorkspaceDirectory()
  const navigate = useNavigate()
  const parsed = parseMentionHref(href)

  // Unresolvable → render the literal text rather than a dead pill.
  if (!parsed) return <>{fallbackLabel}</>

  if (parsed.kind === 'user') {
    const member = directory?.memberById(parsed.id)
    const name = member?.name ?? fallbackLabel.replace(/^@/, '')
    // No directory (e.g. a mention inside a form description on the public /f/<token> page):
    // render a flat, non-interactive pill — a profile popover there would show misleading
    // "no longer a member" copy to an anonymous respondent.
    if (!directory) {
      return (
        <span className={cn(PILL, 'bg-primary/10 text-primary')}>
          <At className="size-3" weight="bold" />
          {name}
        </span>
      )
    }
    return (
      <UserProfilePopover
        userId={parsed.id}
        fallbackName={name}
        fallbackColor={member?.color ?? 'var(--muted-foreground)'}
        fallbackAvatarUrl={member?.avatarUrl}
      >
        <span
          className={cn(
            PILL,
            'bg-primary/10 text-primary hover:bg-primary/20',
            member?.isMe && 'bg-primary/20'
          )}
        >
          <At className="size-3" weight="bold" />
          {name}
        </span>
      </UserProfilePopover>
    )
  }

  if (parsed.kind === 'channel') {
    const channel = directory?.channelById(parsed.id)
    const name = channel?.name ?? fallbackLabel.replace(/^#/, '')
    // Unknown channel (deleted, or no directory): a flat pill, not a broken link.
    if (!channel || !directory) {
      return <span className={cn(PILL, 'bg-muted text-muted-foreground')}>#{name}</span>
    }
    return (
      <button
        type="button"
        onClick={() =>
          void navigate({
            to: '/w/$workspaceId/$channelSlug',
            params: { workspaceId: directory.slug, channelSlug: channel.name }
          })
        }
        className={cn(PILL, 'bg-accent text-accent-foreground hover:bg-accent/70')}
      >
        <ChannelKindIcon kind={channel.kind} className="size-3" />
        {name}
      </button>
    )
  }

  // `@silent` — a directive, not a ping. A muted "Silent" chip tells readers this message was sent
  // without notifications (which is why they weren't pinged even if they were @-mentioned).
  if (parsed.kind === 'directive') {
    const chip = (
      <span className={cn(PILL, 'bg-muted text-muted-foreground')}>
        <BellSlash className="size-3" weight="fill" />
        Silent
      </span>
    )
    return (
      <Tooltip>
        <TooltipTrigger render={chip} />
        <TooltipContent>Sent silently — no notifications</TooltipContent>
      </Tooltip>
    )
  }

  // A role/group ping. Amber matches the "Mentioned you" / "Replied to you"
  // language used elsewhere in the message list.
  const group = mentionGroup(parsed.id)
  const label = group?.label ?? fallbackLabel.replace(/^@/, '')
  const pill = (
    <span className={cn(PILL, 'bg-warning/15 text-warning')}>
      {parsed.id === 'everyone' ? (
        <Megaphone className="size-3" weight="fill" />
      ) : (
        <ShieldStar className="size-3" weight="fill" />
      )}
      @{label}
    </span>
  )

  if (!group) return pill
  return (
    <Tooltip>
      <TooltipTrigger render={pill} />
      <TooltipContent>{group.description}</TooltipContent>
    </Tooltip>
  )
}
