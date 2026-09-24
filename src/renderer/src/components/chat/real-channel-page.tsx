import { Suspense, lazy } from 'react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { Spinner } from '@renderer/components/ui/spinner'
import { DocLoading } from '@renderer/components/doc/doc-loading'
import { KanbanChannelView } from '../kanban/kanban-channel-view'
import { RealDatabaseView } from '@renderer/components/database/real-database-view'
import { RealFormEditor } from '@renderer/components/form/real-form-editor'
import { RealChannelView } from '@renderer/components/chat/real-channel-view'
import { RealChannelHeader } from '@renderer/components/chat/real-channel-header'
import { ChannelDirectoryScope } from '@renderer/components/chat/channel-directory-scope'

// The voice room and the whiteboard are large chunks (LiveKit, Excalidraw ~1MB) — only
// load them for the channel kinds that use them. A static import of either puts it in the
// main bundle and every user pays for it, whether or not they ever open that kind of
// channel.
const RealVoiceView = lazy(() =>
  import('@renderer/components/voice/voice-room').then((module) => ({
    default: module.RealVoiceView
  }))
)
const RealWhiteboardView = lazy(() =>
  import('@renderer/components/whiteboard/real-whiteboard-view').then((module) => ({
    default: module.RealWhiteboardView
  }))
)
// Likewise the doc editor: TipTap plus ~20 highlight.js grammars, Vidstack, and (only if
// the document actually holds one) Excalidraw. A workspace with no docs never loads it.
const RealDocEditor = lazy(() =>
  import('@renderer/components/doc/real-doc-editor').then((module) => ({
    default: module.RealDocEditor
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
    channel.kind === 'kanban' ? (
      <KanbanChannelView key={channel._id} channel={channel} />
    ) : channel.kind === 'database' ? (
      <RealDatabaseView key={channel._id} channel={channel} />
    ) : channel.kind === 'form' ? (
      <RealFormEditor
        key={channel._id}
        channel={channel}
        canManage={!isGuest && (resolved?.role === 'owner' || resolved?.role === 'admin')}
      />
    ) : channel.kind === 'doc' ? (
      // Wrapped in the directory scope so `@person` and `#channel` pills inside the
      // document resolve — the same context chat messages read from.
      <ChannelDirectoryScope channelId={channel._id}>
        <Suspense fallback={<DocLoading />}>
          <RealDocEditor key={channel._id} channelId={channel._id} channelName={channel.name} />
        </Suspense>
      </ChannelDirectoryScope>
    ) : channel.kind === 'whiteboard' ? (
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center">
            <Spinner className="size-6 text-muted-foreground" />
          </div>
        }
      >
        <RealWhiteboardView key={channel._id} channelId={channel._id} />
      </Suspense>
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
          // Resolved server-side (`getChannelAccess`) and shipped with the channel, so a
          // read-only channel paints its lock on the first frame.
          canPost={channel.canPost}
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
