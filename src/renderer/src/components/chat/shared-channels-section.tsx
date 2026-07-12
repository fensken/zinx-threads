import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { toast } from 'sonner'
import { PlugsConnected, SignOut } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { errorMessage } from '@renderer/lib/convex-error'
import { ChannelKindIcon } from '@renderer/components/chat/channel-kind-icon'
import { ConfirmDialog } from '@renderer/components/common/confirm-dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger
} from '@renderer/components/ui/context-menu'
import { cn } from '@renderer/lib/utils'

type SharedChannel = {
  shareId: Id<'channelShares'>
  channelId: Id<'channels'>
  name: string
  kind: string
  ownerWorkspaceName: string
}

/** The "Shared with you" sidebar section — channels another workspace shared INTO
 *  this one. Each links to the channel (resolved via `channels.get`, which grants
 *  guest access) and shows the host workspace as an org badge. Leaving (owner/admin
 *  of THIS workspace) drops access; the host keeps the channel. Renders nothing when
 *  there are no shared channels. */
export function SharedChannelsSection({
  serverId,
  workspaceId
}: {
  serverId: string
  workspaceId: Id<'workspaces'>
}): React.JSX.Element | null {
  const shared = useQuery(api.sharedChannels.listForWorkspace, { workspaceId })
  const leave = useMutation(api.sharedChannels.leave)
  const [leaving, setLeaving] = useState<SharedChannel | null>(null)

  if (!shared || shared.length === 0) return null

  return (
    <div className="mt-3">
      <div className="flex items-center gap-1.5 px-2 pt-1 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        <PlugsConnected className="size-3.5" weight="bold" />
        Shared with you
      </div>
      {shared.map((channel) => (
        <ContextMenu key={channel.channelId}>
          <ContextMenuTrigger
            render={
              // Link by channel **id**, not slug: a shared channel and one of this
              // workspace's OWN channels can share a name, and a slug URL would
              // resolve to the owned one — opening the wrong channel entirely.
              <Link
                to="/w/$workspaceId/c/$channelId"
                params={{ workspaceId: serverId, channelId: channel.channelId }}
                activeProps={{ className: 'bg-sidebar-accent text-foreground' }}
                inactiveProps={{ className: 'text-muted-foreground hover:text-foreground' }}
                className={cn(
                  'group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-sidebar-accent/60'
                )}
              />
            }
          >
            <ChannelKindIcon
              kind={channel.kind}
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 flex-1 truncate">{channel.name}</span>
            {/* Org badge — which workspace hosts this channel (connected via plug). */}
            <span className="flex shrink-0 items-center gap-1 truncate rounded bg-sidebar-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
              <PlugsConnected className="size-2.5 shrink-0" weight="bold" />
              {channel.ownerWorkspaceName}
            </span>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem variant="destructive" onClick={() => setLeaving(channel)}>
              <SignOut className="size-4" />
              Leave channel
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}

      <ConfirmDialog
        open={leaving !== null}
        onOpenChange={(open) => !open && setLeaving(null)}
        title={`Leave #${leaving?.name ?? ''}?`}
        description={
          <>
            Your workspace loses access to this shared channel.{' '}
            <span className="font-medium text-foreground">{leaving?.ownerWorkspaceName}</span> keeps
            it and its history. You can be re-invited later.
          </>
        }
        confirmLabel="Leave channel"
        onConfirm={async () => {
          if (!leaving) return
          try {
            await leave({ channelId: leaving.channelId, workspaceId })
          } catch (err) {
            toast.error(errorMessage(err, 'Could not leave'))
            throw err
          }
        }}
      />
    </div>
  )
}
