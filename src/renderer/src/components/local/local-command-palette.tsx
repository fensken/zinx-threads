import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { FolderOpen, Gear, Plus, SignIn } from '@phosphor-icons/react'
import { ChannelKindIcon } from '@renderer/components/chat/channel-kind-icon'
import { useLocalStore, type LocalChannelKind } from '@renderer/store/local-store'
import { useLocalUiStore } from '@renderer/store/local-ui-store'
import { platform } from '@renderer/lib/platform'
import { WorkspaceGlyph } from '@renderer/components/workspace/workspace-glyph'
import { PaletteDialog, type PaletteItem } from '@renderer/components/layout/command-palette'

/** Offline ⌘K palette — the SAME modal the online app uses (`PaletteDialog`), fed by
 *  the local store instead of Convex. Jump to a page/board, switch offline workspace,
 *  or run an action. Nothing mounts while it's closed. */
/** Kept beside the icon so the palette can't drift from the sidebar's labels. */
const KIND_LABEL: Record<LocalChannelKind, string> = {
  page: 'Page',
  kanban: 'Board',
  whiteboard: 'Whiteboard',
  database: 'Table'
}

export function LocalCommandPalette(): React.JSX.Element | null {
  const open = useLocalUiStore((state) => state.paletteOpen)
  if (!open) return null
  return <LocalPalette />
}

function LocalPalette(): React.JSX.Element {
  const currentWorkspaceId = useLocalStore((state) => state.currentWorkspaceId)
  const allChannels = useLocalStore((state) => state.channels)
  const workspaces = useLocalStore((state) => state.workspaces)
  const createChannel = useLocalStore((state) => state.createChannel)
  const setCurrentWorkspace = useLocalStore((state) => state.setCurrentWorkspace)
  const setOpen = useLocalUiStore((state) => state.setPaletteOpen)
  const openSettings = useLocalUiStore((state) => state.openSettings)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  const close = (): void => setOpen(false)
  const channels = allChannels.filter((c) => c.workspaceId === currentWorkspaceId)

  const items: PaletteItem[] = []

  for (const channel of channels) {
    items.push({
      key: `ch-${channel.id}`,
      group: 'Channels',
      label: channel.name,
      sublabel: KIND_LABEL[channel.kind],
      icon: <ChannelKindIcon kind={channel.kind} className="size-4" />,
      run: () => {
        void navigate({ to: '/local/$channelId', params: { channelId: channel.id } })
        close()
      }
    })
  }

  for (const workspace of workspaces) {
    if (workspace.id === currentWorkspaceId) continue
    items.push({
      key: `ws-${workspace.id}`,
      group: 'Workspaces',
      label: workspace.name,
      sublabel: 'Local',
      icon: (
        <WorkspaceGlyph
          image={workspace.image}
          icon={workspace.icon}
          name={workspace.name}
          className="size-5 overflow-hidden rounded text-foreground"
          iconClassName="size-3.5"
        />
      ),
      run: () => {
        setCurrentWorkspace(workspace.id)
        void navigate({ to: '/local' })
        close()
      }
    })
  }

  const createAndOpen = (kind: LocalChannelKind): void => {
    const id = createChannel(`New ${KIND_LABEL[kind].toLowerCase()}`, kind)
    void navigate({ to: '/local/$channelId', params: { channelId: id } })
    close()
  }

  items.push(
    {
      key: 'a-new-page',
      group: 'Actions',
      label: 'New page',
      icon: <Plus className="size-4" weight="bold" />,
      run: () => createAndOpen('page')
    },
    {
      key: 'a-new-board',
      group: 'Actions',
      label: 'New board',
      icon: <Plus className="size-4" weight="bold" />,
      run: () => createAndOpen('kanban')
    },
    {
      key: 'a-new-whiteboard',
      group: 'Actions',
      label: 'New whiteboard',
      icon: <Plus className="size-4" weight="bold" />,
      run: () => createAndOpen('whiteboard')
    },
    {
      key: 'a-settings',
      group: 'Actions',
      label: 'Open settings',
      icon: <Gear className="size-4" />,
      run: () => {
        openSettings('profile')
        close()
      }
    }
  )

  if (platform.offlineData.isFileBacked()) {
    items.push({
      key: 'a-data-folder',
      group: 'Actions',
      label: currentWorkspaceId ? 'Open workspace folder' : 'Open data folder',
      icon: <FolderOpen className="size-4" />,
      run: () => {
        void platform.offlineData.openFolder(currentWorkspaceId ?? undefined)
        close()
      }
    })
  }

  items.push({
    key: 'a-online',
    group: 'Actions',
    label: 'Sign in to the online app',
    icon: <SignIn className="size-4" />,
    run: () => {
      void navigate({ to: '/' })
      close()
    }
  })

  return (
    <PaletteDialog
      items={items}
      loading={false}
      query={query}
      onQueryChange={setQuery}
      close={close}
    />
  )
}
