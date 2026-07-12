import { X } from '@phosphor-icons/react'

/** A small anchored popover shell used by the sidebar quick-nav and the channel
 *  header (Inbox / Threads / Events). Position via `className` (e.g.
 *  `top-0 left-full ml-2` for the sidebar, `right-0 top-full mt-2` for a header
 *  button); a full-screen scrim closes it on outside click. */
export function NavFlyout({
  title,
  onClose,
  className,
  children
}: {
  title: string
  onClose: () => void
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <>
      <button
        type="button"
        aria-label={`Close ${title}`}
        className="fixed inset-0 z-40 cursor-default"
        onClick={onClose}
      />
      <div
        className={
          'absolute z-50 w-72 overflow-hidden rounded-xl border bg-popover shadow-xl ' +
          (className ?? '')
        }
      >
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">{title}</span>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        {/* `min-h-60` reserves the body so a loading spinner, an empty state and
            a full list all render at the same height — without it the flyout
            pops open short and grows the moment its query lands. `flex-col` so
            a `flex-1` child (LoadingBlock, NavEmptyState) can centre in it. */}
        <div className="no-scrollbar flex max-h-[70dvh] min-h-60 flex-col overflow-y-auto p-3">
          {children}
        </div>
      </div>
    </>
  )
}

export function NavEmptyState({
  icon,
  title,
  message
}: {
  icon: React.ReactNode
  title: string
  message: string
}): React.JSX.Element {
  return (
    // `flex-1` + centred: fills the height the flyout body reserves, so swapping
    // this for a loaded list doesn't resize the popover.
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 py-6 text-center">
      <span className="mb-1 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-52 text-xs text-muted-foreground">{message}</p>
    </div>
  )
}
