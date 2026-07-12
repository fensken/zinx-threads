import { Suspense, lazy } from 'react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { Spinner } from '@renderer/components/ui/spinner'
import { RealBoardView } from '../kanban/real-board-view'
import { RealChannelView } from '@renderer/components/chat/real-channel-view'
import { RealChannelHeader } from '@renderer/components/chat/real-channel-header'
import { ChannelDirectoryScope } from '@renderer/components/chat/channel-directory-scope'

// Page editor + voice room are large chunks (BlockNote, LiveKit) — only load
// them for the channel kinds that use them.
const RealPageEditor = lazy(() =>
  import('@renderer/components/page/real-page-editor').then((module) => ({
    default: module.RealPageEditor
  }))
)
const RealVoiceView = lazy(() =>
  import('@renderer/components/voice/voice-room').then((module) => ({
    default: module.RealVoiceView
  }))
)

/** A real (Convex) channel: **header + content only**. The left sidebar and the
 *  right panel are workspace-level regions owned by the shell, so navigating
 *  between channels swaps just this area (Discord/Slack behaviour).
 *
 *  The channel is resolved from `channels.listBySlug` — the sidebar already
 *  subscribes to it, so switching channels reads from cache and renders
 *  instantly instead of flashing a loading state over the whole page. */
export function RealChannelPage({
  serverId,
  channelId
}: {
  serverId: string
  channelId: string
}): React.JSX.Element {
  const channels = useQuery(api.channels.listBySlug, { slug: serverId })
  const resolved = useQuery(api.workspaces.getBySlug, { slug: serverId })
  const ownedChannel = channels?.find((entry) => entry._id === channelId) ?? null
  // A channel SHARED into this workspace isn't in its own `listBySlug`; resolve it
  // directly (`channels.get` grants guest access). Skipped for owned channels.
  const sharedChannel = useQuery(
    api.channels.get,
    channels !== undefined && !ownedChannel ? { channelId: channelId as Id<'channels'> } : 'skip'
  )
  const channel = ownedChannel ?? sharedChannel ?? null
  const isGuest = !ownedChannel && Boolean(sharedChannel)

  if (channels === undefined || (!ownedChannel && sharedChannel === undefined)) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    )
  }
  if (!channel) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center text-muted-foreground">
        Channel not found.
      </div>
    )
  }

  const body =
    channel.kind === 'page' ? (
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        }
      >
        <RealPageEditor key={channel._id} channel={channel} />
      </Suspense>
    ) : channel.kind === 'kanban' ? (
      <RealBoardView key={channel._id} channel={channel} />
    ) : channel.kind === 'voice' ? (
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        }
      >
        <RealVoiceView key={channel._id} channel={channel} serverSlug={serverId} />
      </Suspense>
    ) : (
      // For a shared channel, augment the directory with the other workspaces'
      // members so `@`-mentions + profile cards resolve everyone with access.
      <ChannelDirectoryScope channelId={channel._id}>
        {/* Keyed per channel so scroll position, draft reply and edit state reset —
            while the header above and the right panel beside it stay mounted. */}
        <RealChannelView
          key={channel._id}
          channel={channel}
          // Guests never moderate a shared channel — the host workspace is in charge.
          canModerate={!isGuest && (resolved?.role === 'owner' || resolved?.role === 'admin')}
        />
      </ChannelDirectoryScope>
    )

  return (
    // `min-h-0` lets the body scroll instead of stretching this column.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
      <RealChannelHeader
        channel={channel}
        workspaceSlug={serverId}
        workspaceId={resolved?.workspace._id}
        canManage={!isGuest && (resolved?.role === 'owner' || resolved?.role === 'admin')}
      />
      {body}
    </div>
  )
}
