import { CaretUpDown, Monitor, Moon, Sidebar, Sun, TextAa, X } from '@phosphor-icons/react'
import { cn } from '@renderer/lib/utils'
import { useThemeStore, type Theme } from '@renderer/store/theme-store'
import { useSettingsStore, type UiScale } from '@renderer/store/settings-store'
import { useUiStore } from '@renderer/store/ui-store'

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

export function SettingsDialog(): React.JSX.Element | null {
  const open = useUiStore((state) => state.settingsOpen)
  const setOpen = useUiStore((state) => state.setSettingsOpen)
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)
  const uiScale = useSettingsStore((state) => state.uiScale)
  const setUiScale = useSettingsStore((state) => state.setUiScale)
  const showServerRail = useSettingsStore((state) => state.showServerRail)
  const setShowServerRail = useSettingsStore((state) => state.setShowServerRail)

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg rounded-xl border bg-card p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold">Appearance</h2>
          <button
            type="button"
            aria-label="Close settings"
            onClick={() => setOpen(false)}
            className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <Section title="Theme" description="Choose how ZiNX looks to you.">
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

        <Section
          title="Workspace switcher"
          description="Switch workspaces from the dropdown, or a Discord-style rail on the left (desktop)."
        >
          <div className="grid grid-cols-2 gap-2">
            <OptionCard active={!showServerRail} onClick={() => setShowServerRail(false)}>
              <CaretUpDown className="size-6" />
              <span>Dropdown</span>
            </OptionCard>
            <OptionCard active={showServerRail} onClick={() => setShowServerRail(true)}>
              <Sidebar className="size-6" />
              <span>Left rail</span>
            </OptionCard>
          </div>
        </Section>
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
