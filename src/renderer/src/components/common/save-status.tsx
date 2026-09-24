import { CheckCircle, CloudArrowUp, WarningCircle } from '@phosphor-icons/react'
import type { SaveState } from '@renderer/lib/use-save-status'

/** A "Saving… / Saved / Not saved" pill — floated bottom-right of an auto-saving surface.
 *  Renders nothing when idle.
 *
 *  `error` names WHY a save failed ("This doc is too large to save", "You don't have
 *  permission to edit this doc"). Without it the only feedback is "Not saved", which tells
 *  someone their work didn't land but not whether trying again could help. */
export function SaveStatus({
  state,
  error
}: {
  state: SaveState
  error?: string | null
}): React.JSX.Element | null {
  if (state === 'idle') return null
  if (state === 'error') {
    return (
      <div className="pointer-events-none absolute right-4 bottom-4 z-20 flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs text-destructive shadow-sm">
        <WarningCircle className="size-3.5" weight="fill" />
        {error ?? 'Not saved'}
      </div>
    )
  }
  return (
    <div className="pointer-events-none absolute right-4 bottom-4 z-20 flex items-center gap-1.5 rounded-full border bg-popover/90 px-2.5 py-1 text-xs text-muted-foreground shadow-sm">
      {state === 'saving' ? (
        <>
          <CloudArrowUp className="size-3.5" />
          Saving…
        </>
      ) : (
        <>
          <CheckCircle className="size-3.5" weight="fill" />
          Saved
        </>
      )}
    </div>
  )
}
