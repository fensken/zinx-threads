import { useRef, useState } from 'react'
import { BRAND } from '@shared/brand'
import { useNavigate } from '@tanstack/react-router'
import {
  FolderOpen,
  Gear,
  Monitor,
  Moon,
  Palette,
  Sun,
  TextAa,
  Trash,
  UserCircle,
  WarningOctagon,
  X
} from '@phosphor-icons/react'
import { toast } from 'sonner'
import { useLocalStore, useCurrentLocalWorkspace } from '@renderer/store/local-store'
import { useLocalUiStore, type LocalSettingsSection } from '@renderer/store/local-ui-store'
import { useThemeStore, type Theme } from '@renderer/store/theme-store'
import { useSettingsStore, type UiScale } from '@renderer/store/settings-store'
import { Avatar } from '@renderer/components/common/avatar'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { Label } from '@renderer/components/ui/label'
import { ConfirmDialog } from '@renderer/components/common/confirm-dialog'
import { UploadableAvatar } from '@renderer/components/common/uploadable-avatar'
import { IconPickerDialog } from '@renderer/components/pickers/icon-picker-dialog'
import { WorkspaceGlyph } from '@renderer/components/workspace/workspace-glyph'
import { SystemPrefsSettings } from '@renderer/components/settings/system-prefs-settings'
import { fileToAvatarDataUrl } from '@renderer/lib/local-avatar'
import { platform } from '@renderer/lib/platform'
import { cn } from '@renderer/lib/utils'

const THEMES: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor }
]
const SCALES: { value: UiScale; label: string; px: string }[] = [
  { value: 'xs', label: 'Compact', px: '12px' },
  { value: 'sm', label: 'Small', px: '14px' },
  { value: 'md', label: 'Default', px: '16px' },
  { value: 'lg', label: 'Large', px: '18px' }
]

const NAV: { id: LocalSettingsSection; label: string; Icon: typeof Sun }[] = [
  { id: 'profile', label: 'My profile', Icon: UserCircle },
  { id: 'appearance', label: 'Appearance', Icon: Palette },
  { id: 'workspace', label: 'Workspace', Icon: Gear },
  { id: 'danger', label: 'Danger zone', Icon: WarningOctagon }
]

/** Offline settings — the local counterpart of the online `SettingsDialog`. Same
 *  left-nav + right-pane layout: your offline profile (name + local avatar),
 *  Appearance (theme + scale, shared with the online app), the workspace (rename +
 *  icon), and a danger zone (delete). Mounted once in the offline shell. */
export function LocalSettingsDialog(): React.JSX.Element | null {
  const open = useLocalUiStore((state) => state.settingsOpen)
  const section = useLocalUiStore((state) => state.settingsSection)
  const setSection = useLocalUiStore((state) => state.openSettings)
  const setOpen = useLocalUiStore((state) => state.setSettingsOpen)

  if (!open) return null

  const activeLabel = NAV.find((n) => n.id === section)?.label ?? ''

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-6"
      onClick={() => setOpen(false)}
    >
      <div
        className="flex h-[90dvh] w-full max-w-6xl overflow-hidden rounded-xl border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <nav className="no-scrollbar w-60 shrink-0 space-y-0.5 overflow-y-auto border-r bg-sidebar/50 p-3">
          <p className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Offline
          </p>
          {NAV.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                section === id
                  ? 'bg-accent font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
              )}
            >
              <Icon className="size-4 shrink-0" weight={section === id ? 'fill' : 'regular'} />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
            <h2 className="truncate text-base font-bold">{activeLabel}</h2>
            <button
              type="button"
              aria-label="Close settings"
              onClick={() => setOpen(false)}
              className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-5" />
            </button>
          </header>
          <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-6">
            <div className="mx-auto w-full max-w-2xl">
              {section === 'profile' ? (
                <ProfilePane />
              ) : section === 'appearance' ? (
                <AppearancePane />
              ) : section === 'workspace' ? (
                <WorkspacePane />
              ) : (
                <DangerPane onDeleted={() => setOpen(false)} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function ProfilePane(): React.JSX.Element {
  const profile = useLocalStore((state) => state.profile)
  const setProfileName = useLocalStore((state) => state.setProfileName)
  const setProfileAvatar = useLocalStore((state) => state.setProfileAvatar)
  const [name, setName] = useState(profile.name)
  const fileInput = useRef<HTMLInputElement>(null)

  const pick = async (file: File): Promise<void> => {
    try {
      setProfileAvatar(await fileToAvatarDataUrl(file))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not use that image')
    }
  }

  return (
    <Section title="Your profile" description="A local identity for this device — no account.">
      <div className="mb-5 flex items-center gap-4">
        <Avatar
          initials={initialsOf(profile.name)}
          color="#f59e0b"
          image={profile.avatar}
          className="size-16 text-lg"
        />
        <div className="flex flex-col gap-1.5">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void pick(file)
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInput.current?.click()}
          >
            Change photo
          </Button>
          {profile.avatar ? (
            <button
              type="button"
              onClick={() => setProfileAvatar(undefined)}
              className="text-left text-xs text-muted-foreground hover:text-destructive"
            >
              Remove photo
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="local-profile-name">Display name</Label>
        <div className="flex items-center gap-2">
          <Input
            id="local-profile-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => setProfileName(name)}
          />
          <Button type="button" onClick={() => setProfileName(name)} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      </div>

      {platform.offlineData.isFileBacked() ? <LocalDataSection /> : null}
    </Section>
  )
}

/** "Open data folder" — reveals where offline data lives: each offline workspace is
 *  its own folder (workspace.json + pages/ + boards/) under this root. Desktop only
 *  (a browser's origin storage has no folder to open). */
function LocalDataSection(): React.JSX.Element {
  return (
    <div className="mt-6 border-t pt-5">
      <h3 className="text-sm font-semibold">Local data</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Every offline workspace is its own folder on this device — pages and boards are saved as
        files inside it.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => {
          void platform.offlineData.openFolder()
        }}
      >
        <FolderOpen className="size-4" />
        Open data folder
      </Button>
    </div>
  )
}

function AppearancePane(): React.JSX.Element {
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)
  const uiScale = useSettingsStore((state) => state.uiScale)
  const setUiScale = useSettingsStore((state) => state.setUiScale)

  return (
    <div>
      <Section title="Theme" description={`Choose how ${BRAND.productName} looks to you.`}>
        <div className="grid grid-cols-3 gap-2">
          {THEMES.map(({ value, label, Icon }) => (
            <OptionCard key={value} active={theme === value} onClick={() => setTheme(value)}>
              <Icon className="size-6" weight={theme === value ? 'fill' : 'regular'} />
              {label}
            </OptionCard>
          ))}
        </div>
      </Section>
      <Section title="Interface scale" description="Zoom the whole interface (4 levels).">
        <div className="grid grid-cols-4 gap-2">
          {SCALES.map(({ value, label, px }) => (
            <OptionCard key={value} active={uiScale === value} onClick={() => setUiScale(value)}>
              <TextAa className="size-6" />
              <span>{label}</span>
              <span className="text-[10px] text-muted-foreground">{px}</span>
            </OptionCard>
          ))}
        </div>
      </Section>
      {/* Launch-at-startup + run-in-background (tray) — desktop only, hidden on web. */}
      {platform.systemPrefs.supported() ? <SystemPrefsSettings /> : null}
    </div>
  )
}

function WorkspacePane(): React.JSX.Element {
  const current = useCurrentLocalWorkspace()
  const renameWorkspace = useLocalStore((state) => state.renameWorkspace)
  const setWorkspaceIcon = useLocalStore((state) => state.setWorkspaceIcon)
  const setWorkspaceImage = useLocalStore((state) => state.setWorkspaceImage)
  const [name, setName] = useState(current?.name ?? '')

  if (!current) {
    return <p className="text-sm text-muted-foreground">No workspace selected.</p>
  }

  const pickLogo = async (file: File): Promise<void> => {
    try {
      // A slightly larger square than the avatar — a logo sits in a bigger tile.
      setWorkspaceImage(current.id, await fileToAvatarDataUrl(file, 256))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not use that image')
    }
  }

  return (
    <Section
      title="Workspace"
      description="Rename this offline workspace, upload a logo, and pick an icon."
    >
      <div className="grid gap-4">
        {/* Logo + icon — same shape as the online General tab (logo overrides icon). */}
        <div className="flex items-center gap-3">
          <UploadableAvatar size="size-14" round={false} bordered onFile={pickLogo}>
            <WorkspaceGlyph
              image={current.image}
              icon={current.icon}
              name={current.name}
              className="size-full text-lg"
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

        <div className="grid gap-1.5">
          <Label htmlFor="local-ws-name">Name</Label>
          <div className="flex items-center gap-2">
            <Input
              id="local-ws-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => renameWorkspace(current.id, name)}
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
        <div className="grid gap-1.5">
          <Label>Icon</Label>
          <IconPickerDialog
            selectedIcon={current.icon}
            onSelect={(icon) => setWorkspaceIcon(current.id, icon || undefined)}
          />
          {current.image ? (
            <p className="text-xs text-muted-foreground">
              A logo is set and takes priority — the icon shows only if you remove it.
            </p>
          ) : null}
        </div>
        {platform.offlineData.isFileBacked() ? (
          <div className="grid gap-1.5">
            <Label>Folder</Label>
            <p className="text-xs text-muted-foreground">
              This workspace lives in its own folder on this device — its pages and boards are files
              inside it.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit gap-2"
              onClick={() => {
                void platform.offlineData.openFolder(current.id)
              }}
            >
              <FolderOpen className="size-4" />
              Open workspace folder
            </Button>
          </div>
        ) : null}
      </div>
    </Section>
  )
}

function DangerPane({ onDeleted }: { onDeleted: () => void }): React.JSX.Element {
  const current = useCurrentLocalWorkspace()
  const deleteWorkspace = useLocalStore((state) => state.deleteWorkspace)
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState(false)

  if (!current) {
    return <p className="text-sm text-muted-foreground">No workspace selected.</p>
  }

  return (
    <Section title="Delete workspace" description="Permanently remove this offline workspace.">
      <div className="rounded-lg border border-destructive/40 p-4">
        <p className="mb-3 text-sm text-muted-foreground">
          Deletes <span className="font-medium text-foreground">{current.name}</span> and all its
          pages and boards from this device. This can’t be undone.
        </p>
        <Button
          variant="outline"
          className="gap-2 text-destructive"
          onClick={() => setConfirm(true)}
        >
          <Trash className="size-4" />
          Delete workspace
        </Button>
      </div>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete "${current.name}"?`}
        description="This permanently removes the workspace and all its pages and boards from this device. This can't be undone."
        confirmLabel="Delete workspace"
        onConfirm={() => {
          deleteWorkspace(current.id)
          onDeleted()
          void navigate({ to: '/local' })
        }}
      />
    </Section>
  )
}

function Section({
  title,
  description,
  children
}: {
  title: string
  description: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-6 last:mb-0">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mb-3 text-xs text-muted-foreground">{description}</p>
      {children}
    </div>
  )
}

function OptionCard({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center gap-1 rounded-lg border-2 py-3 text-sm font-medium transition-colors',
        active
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}
