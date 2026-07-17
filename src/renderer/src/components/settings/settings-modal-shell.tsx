import { X, type Icon } from '@phosphor-icons/react'
import { cn } from '@renderer/lib/utils'

export interface SettingsNavItem {
  id: string
  label: string
  Icon: Icon
}

export interface SettingsNavGroup {
  label: string
  items: SettingsNavItem[]
}

/**
 * The Settings modal frame — **the one shell both the online and local settings dialogs
 * render**, so the two are pixel-identical: the centered overlay + `h-[90dvh] max-w-6xl`
 * card, the `w-60` left nav (grouped), the `h-14` header with the section title + close,
 * and the scrolling `max-w-2xl` pane. The caller supplies the nav groups + the active
 * pane content; the parent gates `open` (returns null when closed).
 */
export function SettingsModalShell({
  onClose,
  groups,
  active,
  onSelect,
  children
}: {
  onClose: () => void
  groups: SettingsNavGroup[]
  active: string
  onSelect: (id: string) => void
  children: React.ReactNode
}): React.JSX.Element {
  const activeLabel = groups
    .flatMap((group) => group.items)
    .find((item) => item.id === active)?.label

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex h-[90dvh] w-full max-w-6xl overflow-hidden rounded-xl border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <nav className="no-scrollbar w-60 shrink-0 space-y-4 overflow-y-auto border-r bg-sidebar/50 p-3">
          {groups.map((group) => (
            <div key={group.label} className="space-y-0.5">
              <p className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {group.label}
              </p>
              {group.items.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelect(id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                    active === id
                      ? 'bg-accent font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                  )}
                >
                  <Icon className="size-4 shrink-0" weight={active === id ? 'fill' : 'regular'} />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>
          ))}
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
            <div className="mx-auto w-full max-w-2xl">{children}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
