import { Gear, Headphones, Microphone } from '@phosphor-icons/react'
import { currentUser } from '@renderer/data/workspaces'
import { useUiStore } from '@renderer/store/ui-store'
import { Avatar } from './avatar'
import { IconButton } from './icon-button'

export function UserPanel(): React.JSX.Element {
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen)

  return (
    <div className="mx-2 mb-2 flex items-center gap-0.5 rounded-lg bg-sidebar-accent/60 px-2 py-1.5 shadow-sm">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left transition-colors hover:bg-sidebar-accent"
        title="Set status"
      >
        <Avatar
          initials={currentUser.initials}
          color={currentUser.color}
          presence={currentUser.presence}
          ringClassName="ring-[3px] ring-sidebar"
          className="size-8"
        />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold text-foreground">{currentUser.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {currentUser.status ?? 'Online'}
          </div>
        </div>
      </button>
      <IconButton label="Mute">
        <Microphone className="size-4" />
      </IconButton>
      <IconButton label="Deafen">
        <Headphones className="size-4" />
      </IconButton>
      <IconButton label="User settings" onClick={() => setSettingsOpen(true)}>
        <Gear className="size-4" />
      </IconButton>
    </div>
  )
}
