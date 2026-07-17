import { useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  BellRinging,
  Export,
  FolderOpen,
  Gear,
  Palette,
  Power,
  UploadSimple,
  UserCircle,
  WarningOctagon
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { useLocalStore, useCurrentLocalWorkspace } from '@renderer/store/local-store'
import { useLocalUiStore, type LocalSettingsSection } from '@renderer/store/local-ui-store'
import { Avatar } from '@renderer/components/common/avatar'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { Label } from '@renderer/components/ui/label'
import { UploadableAvatar } from '@renderer/components/common/uploadable-avatar'
import { IconPickerDialog } from '@renderer/components/pickers/icon-picker-dialog'
import { WorkspaceGlyph } from '@renderer/components/workspace/workspace-glyph'
import {
  SettingsModalShell,
  type SettingsNavGroup
} from '@renderer/components/settings/settings-modal-shell'
import { SystemPrefsSettings } from '@renderer/components/settings/system-prefs-settings'
import { WorkspaceDeleteCard } from '@renderer/components/settings/workspace-delete-card'
// The Appearance + Notifications panes are client-only (theme/scale/sound stores, no
// Convex) — local renders the SAME ones the online app does, so they're identical.
import {
  AppearanceSettings,
  NotificationSettings
} from '@renderer/components/settings/settings-dialog'
import { fileToAvatarDataUrl } from '@renderer/lib/local-avatar'
import { exportWorkspaceZip, readWorkspaceZip } from '@renderer/lib/local-export'
import { platform } from '@renderer/lib/platform'

/** Local-mode settings — the counterpart of the online `SettingsDialog`, using the same
 *  `SettingsModalShell` frame + the same Appearance / Notifications / Startup / delete
 *  components. The two groups mirror online: a device group (profile, appearance,
 *  notifications, startup) + the current workspace's group (general, danger). Only the
 *  server-only sections (account, developers, members, bots) are absent. */
export function LocalSettingsDialog(): React.JSX.Element | null {
  const open = useLocalUiStore((state) => state.settingsOpen)
  const section = useLocalUiStore((state) => state.settingsSection)
  const setSection = useLocalUiStore((state) => state.openSettings)
  const setOpen = useLocalUiStore((state) => state.setSettingsOpen)
  const current = useCurrentLocalWorkspace()

  if (!open) return null

  const groups: SettingsNavGroup[] = [
    {
      label: 'Local',
      items: [
        { id: 'profile', label: 'My profile', Icon: UserCircle },
        { id: 'appearance', label: 'Appearance', Icon: Palette },
        { id: 'notifications', label: 'Notifications', Icon: BellRinging },
        ...(platform.systemPrefs.supported()
          ? [{ id: 'startup', label: 'Startup & tray', Icon: Power }]
          : [])
      ]
    },
    ...(current
      ? [
          {
            label: current.name,
            items: [
              { id: 'workspace', label: 'General', Icon: Gear },
              { id: 'danger', label: 'Danger zone', Icon: WarningOctagon }
            ]
          }
        ]
      : [])
  ]
  const available = groups.flatMap((group) => group.items)
  const active = available.some((item) => item.id === section) ? section : available[0].id

  return (
    <SettingsModalShell
      onClose={() => setOpen(false)}
      groups={groups}
      active={active}
      onSelect={(id) => setSection(id as LocalSettingsSection)}
    >
      {active === 'profile' ? (
        <ProfilePane />
      ) : active === 'appearance' ? (
        <AppearanceSettings />
      ) : active === 'notifications' ? (
        <NotificationSettings />
      ) : active === 'startup' ? (
        <SystemPrefsSettings />
      ) : active === 'workspace' ? (
        <WorkspacePane />
      ) : (
        <DangerPane onDeleted={() => setOpen(false)} />
      )}
    </SettingsModalShell>
  )
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Your local device identity — mirrors the online "My profile" tab's layout (an
 *  uploadable avatar + a name field). */
function ProfilePane(): React.JSX.Element {
  const profile = useLocalStore((state) => state.profile)
  const setProfileName = useLocalStore((state) => state.setProfileName)
  const setProfileAvatar = useLocalStore((state) => state.setProfileAvatar)
  const [name, setName] = useState(profile.name)

  const pick = async (file: File): Promise<void> => {
    try {
      setProfileAvatar(await fileToAvatarDataUrl(file))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not use that image')
    }
  }

  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-3">
        <UploadableAvatar size="size-14" onFile={pick}>
          <Avatar
            initials={initialsOf(profile.name)}
            color="#f59e0b"
            image={profile.avatar}
            className="size-full text-base"
          />
        </UploadableAvatar>
        <div className="min-w-0 leading-tight">
          <div className="font-semibold">{profile.name}</div>
          <div className="text-sm text-muted-foreground">On this device</div>
          {profile.avatar ? (
            <button
              type="button"
              onClick={() => setProfileAvatar(undefined)}
              className="text-xs text-muted-foreground hover:text-destructive"
            >
              Remove photo
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="local-profile-name">Display name</Label>
        <div className="flex items-center gap-2">
          <Input
            id="local-profile-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => setProfileName(name)}
            maxLength={60}
          />
          <Button type="button" onClick={() => setProfileName(name)} disabled={!name.trim()}>
            Save
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          A local identity for this device — no account needed.
        </p>
      </div>

      {platform.offlineData.isFileBacked() ? <LocalDataSection /> : null}
    </div>
  )
}

/** "Open data folder" — reveals where local data lives: each local workspace is its own
 *  folder (workspace.json + pages/ + boards/) under this root. Desktop only. */
function LocalDataSection(): React.JSX.Element {
  return (
    <div className="border-t pt-5">
      <h3 className="text-sm font-semibold">Local data</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Every local workspace is its own folder on this device — pages and boards are saved as files
        inside it.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => void platform.offlineData.openFolder()}
      >
        <FolderOpen className="size-4" />
        Open data folder
      </Button>
    </div>
  )
}

/** The workspace "General" pane — mirrors the online `GeneralTab` (logo + name + icon),
 *  minus the server-only address/timezone, plus local-only export/import + folder. */
function WorkspacePane(): React.JSX.Element {
  const current = useCurrentLocalWorkspace()
  const renameWorkspace = useLocalStore((state) => state.renameWorkspace)
  const setWorkspaceIcon = useLocalStore((state) => state.setWorkspaceIcon)
  const setWorkspaceImage = useLocalStore((state) => state.setWorkspaceImage)
  const importWorkspace = useLocalStore((state) => state.importWorkspace)
  const navigate = useNavigate()
  const importInput = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(current?.name ?? '')

  if (!current) {
    return <p className="text-sm text-muted-foreground">No workspace selected.</p>
  }

  const pickLogo = async (file: File): Promise<void> => {
    try {
      setWorkspaceImage(current.id, await fileToAvatarDataUrl(file, 256))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not use that image')
    }
  }

  const handleExport = (): void => {
    const filename = exportWorkspaceZip(current.id)
    if (filename) toast.success(`Exported ${filename}`)
    else toast.error('Could not export this workspace')
  }

  const handleImport = async (file: File): Promise<void> => {
    const payload = await readWorkspaceZip(file)
    if (!payload) {
      toast.error('That file isn’t a Zinx workspace export')
      return
    }
    importWorkspace(payload)
    toast.success(`Imported “${payload.workspace.name.trim() || 'workspace'}”`)
    void navigate({ to: '/local' })
  }

  return (
    <div className="grid gap-5">
      {/* Logo + icon — same shape as the online General tab (logo overrides icon). */}
      <div className="flex items-center gap-3">
        <UploadableAvatar size="size-14" round={false} bordered onFile={pickLogo}>
          <WorkspaceGlyph
            image={current.image}
            icon={current.icon}
            name={current.name}
            className="size-full text-lg text-foreground"
            iconClassName="size-7"
          />
        </UploadableAvatar>
        <div className="min-w-0 leading-tight">
          <p className="text-sm text-muted-foreground">Workspace logo &amp; icon</p>
          {current.image ? (
            <button
              type="button"
              onClick={() => setWorkspaceImage(current.id, undefined)}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Remove logo
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="local-ws-name">Name</Label>
        <div className="flex items-center gap-2">
          <Input
            id="local-ws-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => renameWorkspace(current.id, name)}
            maxLength={60}
          />
          <Button
            type="button"
            onClick={() => renameWorkspace(current.id, name)}
            disabled={!name.trim()}
          >
            Save
          </Button>
        </div>
      </div>

      <div className="grid gap-2">
        <Label>Icon</Label>
        <IconPickerDialog
          selectedIcon={current.icon}
          onSelect={(icon) => setWorkspaceIcon(current.id, icon || undefined)}
        />
        <span className="text-xs text-muted-foreground">
          {current.image
            ? 'A logo is set and takes priority — the icon shows only if you remove it.'
            : 'Pick an icon, or leave blank to use the app logo.'}
        </span>
      </div>

      <div className="grid gap-2">
        <Label>Export &amp; import</Label>
        <span className="text-xs text-muted-foreground">
          Save this workspace — its pages, boards and whiteboards — as a{' '}
          <span className="font-medium">.zip</span> to back it up or carry it to another device.
          Importing a workspace <span className="font-medium">.zip</span> adds it here as a new
          workspace.
        </span>
        <input
          ref={importInput}
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void handleImport(file)
          }}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={handleExport}
          >
            <Export className="size-4" />
            Export workspace
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => importInput.current?.click()}
          >
            <UploadSimple className="size-4" />
            Import workspace
          </Button>
        </div>
      </div>

      {platform.offlineData.isFileBacked() ? (
        <div className="grid gap-2">
          <Label>Folder</Label>
          <span className="text-xs text-muted-foreground">
            This workspace lives in its own folder on this device — its pages and boards are files
            inside it.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit gap-2"
            onClick={() => void platform.offlineData.openFolder(current.id)}
          >
            <FolderOpen className="size-4" />
            Open workspace folder
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** The danger zone — the **same** `WorkspaceDeleteCard` (type-the-name-to-confirm) the
 *  online app uses, wired to the local store's delete. */
function DangerPane({ onDeleted }: { onDeleted: () => void }): React.JSX.Element {
  const current = useCurrentLocalWorkspace()
  const deleteWorkspace = useLocalStore((state) => state.deleteWorkspace)
  const navigate = useNavigate()

  if (!current) {
    return <p className="text-sm text-muted-foreground">No workspace selected.</p>
  }

  return (
    <div className="grid gap-4">
      <WorkspaceDeleteCard
        workspaceName={current.name}
        description="Permanently removes this workspace and all its pages, boards and whiteboards from this device. This can’t be undone."
        onDelete={async () => {
          deleteWorkspace(current.id)
          onDeleted()
          void navigate({ to: '/local' })
        }}
      />
    </div>
  )
}
