import { Suspense, lazy } from 'react'
import { useLocalStore, type LocalChannel } from '@renderer/store/local-store'
import { SidebarToggle } from '@renderer/components/layout/sidebar-toggle'
import { ChannelKindIcon } from '@renderer/components/chat/channel-kind-icon'
import { EditableChannelName } from '@renderer/components/chat/editable-channel-name'
import { Spinner } from '@renderer/components/ui/spinner'
import { LocalBoardView } from '@renderer/components/local/local-board-view'

// BlockNote (~900kB) and Excalidraw (~1MB) are large chunks — only load them for the
// channel kinds that use them (mirrors the online lazy split).
const LocalPageEditor = lazy(() =>
  import('@renderer/components/local/local-page-editor').then((module) => ({
    default: module.LocalPageEditor
  }))
)
const LocalWhiteboardView = lazy(() =>
  import('@renderer/components/whiteboard/local-whiteboard-view').then((module) => ({
    default: module.LocalWhiteboardView
  }))
)

/** Renders one offline channel: a header (sidebar toggle + renameable name, like the
 *  online `RealChannelHeader`) + the page editor or the board. */
export function LocalChannelView({ channel }: { channel: LocalChannel }): React.JSX.Element {
  const rename = useLocalStore((state) => state.renameChannel)

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <SidebarToggle />
        <EditableChannelName
          name={channel.name}
          icon={
            <ChannelKindIcon
              kind={channel.kind}
              className="size-5 shrink-0 text-muted-foreground"
            />
          }
          onRename={(name) => rename(channel.id, name)}
        />
      </header>

      {channel.kind === 'page' ? (
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center">
              <Spinner className="size-6 text-muted-foreground" />
            </div>
          }
        >
          <LocalPageEditor key={channel.id} channelId={channel.id} channelName={channel.name} />
        </Suspense>
      ) : channel.kind === 'whiteboard' ? (
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center">
              <Spinner className="size-6 text-muted-foreground" />
            </div>
          }
        >
          <LocalWhiteboardView key={channel.id} channelId={channel.id} />
        </Suspense>
      ) : (
        <LocalBoardView key={channel.id} channelId={channel.id} />
      )}
    </div>
  )
}
