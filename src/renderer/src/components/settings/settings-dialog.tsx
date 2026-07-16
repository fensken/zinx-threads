import {
  BellRinging,
  FolderOpen,
  Gear,
  IdentificationCard,
  Monitor,
  Moon,
  Palette,
  Plugs,
  Power,
  Robot,
  Sun,
  TextAa,
  UserCircle,
  UsersThree,
  WarningOctagon,
  Wrench,
  X
} from '@phosphor-icons/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { BRAND } from '@shared/brand'
import { api } from '@convex/_generated/api'
import type { Doc } from '@convex/_generated/dataModel'
import { cn } from '@renderer/lib/utils'
import { authEnabled } from '@renderer/lib/auth-client'
import { platform } from '@renderer/lib/platform'
import { Button } from '@renderer/components/ui/button'
import { Switch } from '@renderer/components/ui/switch'
import { toast } from 'sonner'
import { playNotificationSound, previewNotificationSound } from '@renderer/lib/sounds'
import { useThemeStore, type Theme } from '@renderer/store/theme-store'
import { useSettingsStore, type UiScale } from '@renderer/store/settings-store'
import { useUiStore, type SettingsSection } from '@renderer/store/ui-store'
import { Spinner } from '@renderer/components/ui/spinner'
import { AccountControls } from '@renderer/components/settings/account-controls'
import { SystemPrefsSettings } from '@renderer/components/settings/system-prefs-settings'
import { DeveloperSettings } from '@renderer/components/settings/developer-settings'
import { BotsTab } from '@renderer/components/settings/bots-settings'
import {
  DangerTab,
  GeneralTab,
  MembersTab,
  ProfileTab,
  type Role
} from '@renderer/components/settings/workspace-settings'

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

type WorkspaceInfo = { workspace: Doc<'workspaces'>; role: Role; displayName?: string }
type NavItem = { id: SettingsSection; label: string; Icon: typeof Sun }

/** Unified Settings modal — user settings (account, appearance) + the current
 *  workspace's settings (profile, general, members, danger) behind one left nav.
 *  `workspaceSlug` = the shell's active workspace; resolved to real Convex data
 *  when `authEnabled`. Capped at 90dvh; each pane scrolls independently. */
export function SettingsDialog({
  workspaceSlug
}: {
  workspaceSlug?: string
}): React.JSX.Element | null {
  const open = useUiStore((state) => state.settingsOpen)
  const setOpen = useUiStore((state) => state.setSettingsOpen)

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-6"
      onClick={() => setOpen(false)}
    >
      <div
        className="flex h-[90dvh] w-full max-w-6xl overflow-hidden rounded-xl border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {authEnabled && workspaceSlug ? (
          <ConvexSettings workspaceSlug={workspaceSlug} onClose={() => setOpen(false)} />
        ) : (
          <SettingsPanes workspace={null} onClose={() => setOpen(false)} />
        )}
      </div>
    </div>
  )
}

/** Resolve the active workspace (real Convex) for the Workspace section. Null →
 *  a demo/unknown slug or non-member: the modal shows only user settings. */
function ConvexSettings({
  workspaceSlug,
  onClose
}: {
  workspaceSlug: string
  onClose: () => void
}): React.JSX.Element {
  const resolved = useQuery(api.workspaces.getBySlug, { slug: workspaceSlug })
  const workspace: WorkspaceInfo | null =
    resolved && resolved !== null
      ? { workspace: resolved.workspace, role: resolved.role, displayName: resolved.displayName }
      : null
  return <SettingsPanes workspace={workspace} loading={resolved === undefined} onClose={onClose} />
}

function SettingsPanes({
  workspace,
  loading = false,
  onClose
}: {
  workspace: WorkspaceInfo | null
  loading?: boolean
  onClose: () => void
}): React.JSX.Element {
  const section = useUiStore((state) => state.settingsSection)
  const setSection = useUiStore((state) => state.setSettingsSection)

  const userItems: NavItem[] = [
    ...(authEnabled ? [{ id: 'account' as const, label: 'My Account', Icon: UserCircle }] : []),
    { id: 'appearance', label: 'Appearance', Icon: Palette },
    { id: 'notifications', label: 'Notifications', Icon: BellRinging },
    // Desktop only — launch-at-startup + run-in-background (tray). Web has neither.
    ...(platform.systemPrefs.supported()
      ? [{ id: 'startup' as const, label: 'Startup & tray', Icon: Power }]
      : []),
    ...(authEnabled ? [{ id: 'developers' as const, label: 'Developers', Icon: Plugs }] : []),
    // Desktop only — on the web there's no data folder to open, so the section would be
    // an empty room.
    ...(platform.canRevealDataFolder()
      ? [{ id: 'advanced' as const, label: 'Advanced', Icon: Wrench }]
      : [])
  ]
  const wsItems: NavItem[] = workspace
    ? [
        { id: 'ws-profile', label: 'My profile', Icon: IdentificationCard },
        { id: 'ws-general', label: 'General', Icon: Gear },
        { id: 'ws-members', label: 'Members', Icon: UsersThree },
        { id: 'ws-bots', label: 'Bots', Icon: Robot },
        { id: 'ws-danger', label: 'Danger zone', Icon: WarningOctagon }
      ]
    : []

  const available = [...userItems, ...wsItems]
  const active = available.some((i) => i.id === section) ? section : available[0].id
  const activeLabel = available.find((i) => i.id === active)?.label ?? ''

  return (
    <>
      <nav className="no-scrollbar w-60 shrink-0 space-y-4 overflow-y-auto border-r bg-sidebar/50 p-3">
        <NavGroup label="User settings" items={userItems} active={active} onPick={setSection} />
        {wsItems.length ? (
          <NavGroup
            label={workspace ? workspace.workspace.name : 'Workspace'}
            items={wsItems}
            active={active}
            onPick={setSection}
          />
        ) : null}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
          <h2 className="truncate text-base font-bold">{activeLabel}</h2>
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-6">
          <div className="mx-auto w-full max-w-2xl">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner className="size-4" />
                Loading…
              </div>
            ) : (
              <SectionContent active={active} workspace={workspace} />
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function SectionContent({
  active,
  workspace
}: {
  active: SettingsSection
  workspace: WorkspaceInfo | null
}): React.JSX.Element {
  if (active === 'account') return <AccountControls />
  if (active === 'appearance') return <AppearanceSettings />
  if (active === 'notifications') return <NotificationSettings />
  if (active === 'startup') return <SystemPrefsSettings />
  if (active === 'developers') return <DeveloperSettings />
  if (active === 'advanced') return <AdvancedSettings />

  // Workspace sections — only reachable when a workspace resolved.
  if (!workspace) return <AppearanceSettings />
  const canManage = workspace.role === 'owner' || workspace.role === 'admin'
  if (active === 'ws-profile') {
    return (
      <ProfileTab
        workspaceId={workspace.workspace._id}
        initialDisplayName={workspace.displayName ?? ''}
      />
    )
  }
  if (active === 'ws-general')
    return <GeneralTab workspace={workspace.workspace} canManage={canManage} />
  if (active === 'ws-members') {
    return <MembersTab workspaceId={workspace.workspace._id} canManage={canManage} />
  }
  if (active === 'ws-bots') return <BotsTab workspace={workspace.workspace} canManage={canManage} />
  return (
    <DangerTab
      workspaceId={workspace.workspace._id}
      workspaceName={workspace.workspace.name}
      isOwner={workspace.role === 'owner'}
    />
  )
}

function AppearanceSettings(): React.JSX.Element {
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

      <Section
        title="Interface scale"
        description="Zoom the whole interface — text, spacing, and controls (4 levels)."
      >
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
    </div>
  )
}

function NotificationSettings(): React.JSX.Element {
  const soundEnabled = useSettingsStore((state) => state.soundEnabled)
  const setSoundEnabled = useSettingsStore((state) => state.setSoundEnabled)
  const soundVolume = useSettingsStore((state) => state.soundVolume)
  const setSoundVolume = useSettingsStore((state) => state.setSoundVolume)
  const desktopNotifications = useSettingsStore((state) => state.desktopNotifications)
  const setDesktopNotifications = useSettingsStore((state) => state.setDesktopNotifications)

  return (
    <div>
      <Section
        title="Sounds"
        description="A chime when something arrives, and when a call starts or ends."
      >
        <div className="grid gap-3">
          <ToggleRow
            label="Sounds"
            hint="Messages, and joining or leaving a call."
            checked={soundEnabled}
            onChange={(next) => {
              setSoundEnabled(next)
              // Play the chime as you switch it on, so the setting demonstrates
              // itself rather than being a promise you have to test by waiting.
              if (next) previewNotificationSound()
            }}
          />

          {soundEnabled ? <VolumeSlider value={soundVolume} onChange={setSoundVolume} /> : null}
        </div>
      </Section>

      <Section
        title="Desktop notifications"
        description="A banner from your operating system when something needs you."
      >
        <div className="grid gap-3">
          <ToggleRow
            label="Desktop notifications"
            hint="Only while the app is in the background — you’re never notified about what’s already on your screen."
            checked={desktopNotifications}
            onChange={(next) => {
              setDesktopNotifications(next)
              // Switching it on shows you one, immediately. The banner is drawn by the OS,
              // so the only honest preview is a real notification — an in-app mock-up would
              // be our idea of what Windows looks like, not what Windows looks like.
              if (next) void sendSampleNotification()
            }}
          />
          {desktopNotifications ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit gap-2"
              onClick={() => void sendSampleNotification()}
            >
              <BellRinging className="size-4" />
              Send a test notification
            </Button>
          ) : null}
        </div>
      </Section>
    </div>
  )
}

/**
 * Notification volume.
 *
 * A native `<input type="range">`, deliberately — the shadcn/Base-UI `Slider` was tried
 * twice here and its wrapper derives its **thumb count from the `value` prop**, so it is a
 * two-thumb range slider unless fed an array. That left a thumb pinned at the minimum (the
 * one you grab), which is why it read 0% and would not move.
 *
 * The fill is a `linear-gradient` on the track, cut at the current percentage: the reason
 * the original had no fill is that `appearance-none` strips the native track *including*
 * the filled portion, and `accent-color` then has nothing to paint. Both stops are theme
 * tokens, so it follows a palette swap.
 */
function VolumeSlider({
  value,
  onChange
}: {
  value: number
  onChange: (value: number) => void
}): React.JSX.Element {
  const percent = Math.round(value * 100)
  return (
    <div className="flex items-center gap-3 pl-1">
      <span className="w-20 shrink-0 text-sm text-muted-foreground">Volume</span>
      <input
        type="range"
        min={0}
        max={100}
        value={percent}
        aria-label="Notification volume"
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        // Preview on release, not on every pixel of the drag — otherwise it machine-guns
        // the chime while you're still choosing.
        onPointerUp={() => previewNotificationSound()}
        onKeyUp={() => previewNotificationSound()}
        style={{
          background: `linear-gradient(to right, var(--primary) ${percent}%, var(--muted) ${percent}%)`
        }}
        className={cn(
          'h-1.5 flex-1 cursor-pointer appearance-none rounded-full',
          // The thumb has to be styled per-engine — there is no cross-browser selector.
          '[&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:ring-2 [&::-webkit-slider-thumb]:ring-background',
          '[&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-primary'
        )}
      />
      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {percent}%
      </span>
    </div>
  )
}

/** A real OS banner, shaped exactly like the ones the app sends (`NotificationBridge`'s
 *  "Alice in #general" title + a message preview) — no `route`, so clicking it goes nowhere
 *  rather than to a message that doesn't exist. On the web this is also where the permission
 *  prompt happens, because clicking the toggle IS the user asking for it. */
async function sendSampleNotification(): Promise<void> {
  const allowed = await platform.requestNotificationPermission()
  if (!allowed) {
    toast.error(
      'Your browser is blocking notifications — allow them for this site, then try again.'
    )
    return
  }
  platform.notify({
    title: 'Alice in #general',
    body: `This is what a notification from ${BRAND.productName} looks like.`,
    // Share a tag so clicking "test" repeatedly replaces the banner instead of stacking a
    // pile of them in the OS notification centre.
    tag: 'zinx-test'
  })
  // The chime is OURS, not the OS's — `platform.notify` sends `silent` so the two don't
  // stack. A real notification is banner *and* chime, so the sample has to be both, or it
  // isn't a preview of anything. Gated on the Sounds toggle + volume by `sounds.ts`, which
  // is exactly right: with sound off, a real one would be silent too.
  playNotificationSound()
}

function AdvancedSettings(): React.JSX.Element {
  return (
    <div>
      <Section
        title="Local data"
        description="Your settings and offline workspaces are saved on this device, inside the app’s data folder."
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => {
            void platform.openDataFolder()
          }}
        >
          <FolderOpen className="size-4" />
          Open data folder
        </Button>
      </Section>
    </div>
  )
}

function NavGroup({
  label,
  items,
  active,
  onPick
}: {
  label: string
  items: NavItem[]
  active: SettingsSection
  onPick: (section: SettingsSection) => void
}): React.JSX.Element {
  return (
    <div>
      <p className="mb-1 truncate px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <div className="space-y-0.5">
        {items.map(({ id, label: itemLabel, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onPick(id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              active === id
                ? 'bg-accent font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
            )}
          >
            <Icon className="size-4 shrink-0" weight={active === id ? 'fill' : 'regular'} />
            <span className="truncate">{itemLabel}</span>
          </button>
        ))}
      </div>
    </div>
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

/** A labelled switch. Clicking anywhere on the row toggles it — a 40px target for a
 *  setting beats a 20px one, and the label is the thing people aim at. */
function ToggleRow({
  label,
  hint,
  checked,
  onChange
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border p-3 transition-colors hover:bg-accent/40">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      <Switch checked={checked} onCheckedChange={onChange} className="shrink-0" />
    </label>
  )
}
