import { Suspense, lazy, useState } from 'react'
import { Question } from '@phosphor-icons/react'
import { useLocalStore, type LocalChannel } from '@renderer/store/local-store'
import { SidebarToggle } from '@renderer/components/layout/sidebar-toggle'
import { ChannelKindIcon } from '@renderer/components/chat/channel-kind-icon'
import { ChannelHelpDialog } from '@renderer/components/chat/channel-help-dialog'
import { EditableChannelName } from '@renderer/components/chat/editable-channel-name'
import { IconButton } from '@renderer/components/common/icon-button'
import { Spinner } from '@renderer/components/ui/spinner'
import { DocLoading } from '@renderer/components/doc/doc-loading'
import { LocalBoardView } from '@renderer/components/local/local-board-view'
import { LocalDatabaseView } from '@renderer/components/local/local-database-view'

// Excalidraw (~1MB) is a large chunk — only load it for the channel kinds that use it
// (mirrors the online lazy split).
const LocalWhiteboardView = lazy(() =>
  import('@renderer/components/whiteboard/local-whiteboard-view').then((module) => ({
    default: module.LocalWhiteboardView
  }))
)
// Likewise the doc editor (TipTap + ~20 highlight.js grammars + Vidstack), matching the
// online split — a local workspace with no docs never loads it.
const LocalDocEditor = lazy(() =>
  import('@renderer/components/local/local-doc-editor').then((module) => ({
    default: module.LocalDocEditor
  }))
)

/** Renders one offline channel: a header (sidebar toggle + renameable name, like the
 *  online `RealChannelHeader`) + the page editor or the board. */
export function LocalChannelView({ channel }: { channel: LocalChannel }): React.JSX.Element {
  const rename = useLocalStore((state) => state.renameChannel)
  const [helpOpen, setHelpOpen] = useState(false)

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
        <IconButton
          label="About this channel"
          className="ml-auto"
          onClick={() => setHelpOpen(true)}
        >
          <Question className="size-5" />
        </IconButton>
      </header>
      <ChannelHelpDialog
        channel={{ kind: channel.kind }}
        canManage
        open={helpOpen}
        onOpenChange={setHelpOpen}
      />

      {channel.kind === 'whiteboard' ? (
        <Suspense
          fallback={
            <div className="flex flex-1 items-center justify-center">
              <Spinner className="size-6 text-muted-foreground" />
            </div>
          }
        >
          <LocalWhiteboardView key={channel.id} channelId={channel.id} />
        </Suspense>
      ) : channel.kind === 'doc' ? (
        <Suspense fallback={<DocLoading />}>
          <LocalDocEditor key={channel.id} channelId={channel.id} channelName={channel.name} />
        </Suspense>
      ) : channel.kind === 'database' ? (
        <LocalDatabaseView key={channel.id} channelId={channel.id} />
      ) : (
        <LocalBoardView key={channel.id} channelId={channel.id} />
      )}
    </div>
  )
}
