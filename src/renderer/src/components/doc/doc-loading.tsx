import { Notebook } from '@phosphor-icons/react'

/** Shown while the doc editor's chunk downloads (TipTap + the highlight.js grammars).
 *  Distinct from `DocSkeleton`, which stands in for a document that is *loading its
 *  content* — here there is no editor yet at all, so there is no layout to mirror. */
export function DocLoading(): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <Notebook className="size-16 animate-pulse text-muted-foreground" weight="duotone" />
        <p className="text-sm text-muted-foreground">Loading doc…</p>
      </div>
    </div>
  )
}
