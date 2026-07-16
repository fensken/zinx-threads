import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'
import {
  CalendarBlank,
  ChatCircle,
  Clock,
  CrownSimple,
  EnvelopeSimple,
  Robot
} from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { Avatar } from '@renderer/components/common/avatar'
import { StatusGlyph } from '@renderer/components/common/status-glyph'
import { useWorkspaceDirectory } from '@renderer/components/chat/workspace-directory-context'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { errorMessage } from '@renderer/lib/convex-error'
import { initialsOf } from '@renderer/lib/initials'
import { avatarImageFor } from '@renderer/lib/app-logo'
import { localTimeLabel } from '@renderer/lib/timezone'
import { useNow } from '@renderer/lib/use-now'
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
  const navigate = useNavigate()
  const openDm = useMutation(api.dms.open)
  const [opening, setOpening] = useState(false)
  // `useNow()` ticks every 30s, so their clock stays right while the card is open
  // instead of freezing at the moment it was rendered. (It hands back a `Date`; the
  // zone helpers take epoch-ms, which is the one representation we store.)
  const now = useNow().getTime()

  const name = member?.name ?? fallbackName
  const color = member?.color ?? fallbackColor
  const avatarUrl = member?.avatarUrl ?? fallbackAvatarUrl
  const status = normalizeStatus(member?.presence)
  const customStatus = member?.statusText?.trim()

  /** Find-or-create the conversation with this person, then go to it. */
  const message = async (id: string): Promise<void> => {
    if (!directory || opening) return
    setOpening(true)
    try {
      const channelId = await openDm({
        workspaceId: directory.workspaceId as Id<'workspaces'>,
        userIds: [id as Id<'users'>]
      })
      await navigate({
        to: '/w/$workspaceId/d/$channelId',
        params: { workspaceId: directory.slug, channelId }
      })
    } catch (err) {
      toast.error(errorMessage(err, 'Could not open the conversation'))
    } finally {
      setOpening(false)
    }
  }

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
            image={avatarImageFor(avatarUrl, member?.isBot)}
            presence={presenceWithConnectivity(member?.presence, isOnline)}
            className="size-14 text-base"
            ringClassName="ring-2 ring-popover"
          />
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate text-sm font-semibold">{name}</p>
            {member?.isMe ? (
              <p className="text-xs italic text-muted-foreground">This is you</p>
            ) : null}
            {member?.isBot ? (
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-info/15 px-2 py-0.5 text-[11px] font-medium text-info">
                <Robot className="size-3" weight="fill" />
                Bot
              </span>
            ) : member && member.role !== 'member' ? (
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
            {/* Their local clock (Slack's profile line) — so you can tell at a glance
                whether it's a reasonable hour to ping them. Shown for anyone whose zone we
                know (including yourself); a person with no timezone set shows nothing. */}
            {member.timezone ? (
              <p className="flex items-center gap-2">
                <Clock className="size-3.5 shrink-0" />
                <span>{localTimeLabel(member.timezone, now)}</span>
              </p>
            ) : null}
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

        {/* The action the card exists for. Not shown on your own card (there's no
            note-to-self conversation) or for someone who has left the workspace. */}
        {member && !member.isMe && !member.isBot && directory ? (
          <div className="border-t p-2">
            <button
              type="button"
              disabled={opening}
              onClick={() => void message(member.userId)}
              className="flex w-full items-center justify-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-60"
            >
              <ChatCircle className="size-4" />
              {opening ? 'Opening…' : `Message ${member.name.split(/\s+/)[0]}`}
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
