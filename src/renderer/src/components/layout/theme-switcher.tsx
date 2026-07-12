import { Monitor, Moon, Sun } from '@phosphor-icons/react'
import { cn } from '@renderer/lib/utils'
import { useThemeStore, type Theme } from '@renderer/store/theme-store'

const OPTIONS: ReadonlyArray<{ value: Theme; label: string; Icon: typeof Sun }> = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor }
]

export function ThemeSwitcher(): React.JSX.Element {
  const theme = useThemeStore((state) => state.theme)
  const setTheme = useThemeStore((state) => state.setTheme)

  return (
    <div
      role="group"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-md border bg-card p-0.5 shadow-xs"
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          title={label}
          aria-label={label}
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
          className={cn(
            'inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
            theme === value &&
              'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
          )}
        >
          <Icon className="size-4" weight={theme === value ? 'fill' : 'regular'} />
        </button>
      ))}
    </div>
  )
}
