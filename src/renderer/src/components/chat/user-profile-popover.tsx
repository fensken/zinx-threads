import { CalendarBlank, CrownSimple, EnvelopeSimple } from '@phosphor-icons/react'
import { Avatar } from '@renderer/components/common/avatar'
import { StatusGlyph } from '@renderer/components/common/status-glyph'
import { useWorkspaceDirectory } from '@renderer/components/chat/workspace-directory-context'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { initialsOf } from '@renderer/lib/initials'
import { normalizeStatus, presenceWithConnectivity, STATUS_LABEL } from '@renderer/lib/user-status'
import { useIsOnline } from '@renderer/store/presence-store'

function joinedLabel(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/** Wraps an author's avatar or name in a hover-card-style profile popover, the
 *  way `_zinx`'s `UserProfilePopover` does — except ours leads with **status**,
 *  which is the identity signal unique to this app: a user's presence is whatever
 *  they set, plus an optional custom emoji + text.
 *
 *  Everything is read from the already-subscribed workspace directory, so opening
 *  the card costs no round-trip. `fallback*` covers an author who has since left
 *  the workspace (no directory row). */
export function UserProfilePopover({
  userId,
  fallbackName,
  fallbackColor,
  fallbackAvatarUrl,
  children
}: {
  userId: string
  fallbackName: string
  fallbackColor: string
  fallbackAvatarUrl?: string | null
  children: React.ReactNode
}): React.JSX.Element {
  const directory = useWorkspaceDirectory()
  const member = directory?.memberById(userId)
  const isOnline = useIsOnline(userId)

  const name = member?.name ?? fallbackName
  const color = member?.color ?? fallbackColor
  const avatarUrl = member?.avatarUrl ?? fallbackAvatarUrl
  const status = normalizeStatus(member?.presence)
  const customStatus = member?.statusText?.trim()

  return (
    <Popover>
      {/* A `<span>`, not the default `<button>` (exactly what `_zinx` does).
          Chrome's UA stylesheet vertically centres a button's content, so a
          stretched trigger pushed the avatar to the middle of a tall message. */}
      <PopoverTrigger
        render={<span />}
        nativeButton={false}
        className="cursor-pointer rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {children}
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-72 gap-0 p-0">
        <div className="flex items-start gap-3 p-4 pb-3">
          <Avatar
            initials={initialsOf(name)}
            color={color}
            image={avatarUrl}
            presence={presenceWithConnectivity(member?.presence, isOnline)}
            className="size-14 text-base"
            ringClassName="ring-2 ring-popover"
          />
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate text-sm font-semibold">{name}</p>
            {member?.isMe ? (
              <p className="text-xs italic text-muted-foreground">This is you</p>
            ) : null}
            {member && member.role !== 'member' ? (
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium capitalize text-primary">
                {member.role === 'owner' ? <CrownSimple className="size-3" weight="fill" /> : null}
                {member.role}
              </span>
            ) : null}
          </div>
        </div>

        {/* Status — our own thing: a static presence the user chooses, plus an
            optional custom line. Always shown; presence is never "unknown". */}
        <div className="mx-4 flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-2">
          {member?.statusEmoji ? (
            <span className="text-base leading-none">{member.statusEmoji}</span>
          ) : (
            <StatusGlyph status={status} className="size-4" />
          )}
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {customStatus || STATUS_LABEL[status]}
          </span>
          {customStatus ? <StatusGlyph status={status} className="size-3.5 shrink-0" /> : null}
        </div>

        {member ? (
          <div className="space-y-1.5 p-4 pt-3 text-xs text-muted-foreground">
            <p className="flex items-center gap-2">
              <EnvelopeSimple className="size-3.5 shrink-0" />
              <span className="truncate">{member.email}</span>
            </p>
            <p className="flex items-center gap-2">
              <CalendarBlank className="size-3.5 shrink-0" />
              <span>Joined {joinedLabel(member.joinedAt)}</span>
            </p>
          </div>
        ) : (
          <p className="p-4 pt-3 text-xs text-muted-foreground">
            No longer a member of this workspace.
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
