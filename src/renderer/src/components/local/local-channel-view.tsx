import { Suspense, lazy } from 'react'
import { FileText, Kanban, SidebarSimple } from '@phosphor-icons/react'
import { useLocalStore, type LocalChannel } from '@renderer/store/local-store'
import { useUiStore } from '@renderer/store/ui-store'
import { IconButton } from '@renderer/components/common/icon-button'
import { EditableChannelName } from '@renderer/components/chat/editable-channel-name'
import { Spinner } from '@renderer/components/ui/spinner'
import { LocalBoardView } from '@renderer/components/local/local-board-view'

// BlockNote is a large chunk — only load it for `page` channels (mirrors the online
// `RealPageEditor` lazy split).
const LocalPageEditor = lazy(() =>
  import('@renderer/components/local/local-page-editor').then((module) => ({
    default: module.LocalPageEditor
  }))
)

/** Renders one offline channel: a header (sidebar toggle + renameable name, like the
 *  online `RealChannelHeader`) + the page editor or the board. */
export function LocalChannelView({ channel }: { channel: LocalChannel }): React.JSX.Element {
  const rename = useLocalStore((state) => state.renameChannel)
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)

  const icon =
    channel.kind === 'kanban' ? (
      <Kanban className="size-5 shrink-0 text-muted-foreground" />
    ) : (
      <FileText className="size-5 shrink-0 text-muted-foreground" />
    )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-card">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
        <IconButton
          label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          active={sidebarCollapsed}
          onClick={toggleSidebar}
        >
          <SidebarSimple className="size-5" />
        </IconButton>
        <EditableChannelName
          name={channel.name}
          icon={icon}
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
      ) : (
        <LocalBoardView key={channel.id} channelId={channel.id} />
      )}
    </div>
  )
}
