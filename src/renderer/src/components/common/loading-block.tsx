import { Spinner } from '@renderer/components/ui/spinner'
import { cn } from '@renderer/lib/utils'

/** A spinner that **fills** its parent rather than collapsing to its own height.
 *
 *  Half of avoiding layout shift; the other half is on the container. A loading
 *  placeholder only avoids a jump if it occupies the same box the loaded content
 *  will, so whatever renders this must already have a height of its own —
 *  `flex-1` inside a full-height column (the message list, the board, the page
 *  editor, the members panel), or a reserved `min-h-*` / fixed height when the
 *  surface is otherwise sized by its content (a palette, a flyout, a dialog).
 *
 *  Get that wrong and the spinner renders 40px tall, then the real content snaps
 *  the surface to 400px. */
export function LoadingBlock({ className }: { className?: string }): React.JSX.Element {
  return (
    <div className={cn('flex min-h-0 flex-1 items-center justify-center', className)}>
      <Spinner className="size-5 text-muted-foreground" />
    </div>
  )
}
