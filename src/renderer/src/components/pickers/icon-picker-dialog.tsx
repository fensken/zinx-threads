import { memo, useState } from 'react'
import { CaretDown, MagnifyingGlass, Smiley, X } from '@phosphor-icons/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Command, CommandEmpty, CommandInput, CommandList } from '@renderer/components/ui/command'
import { cn } from '@renderer/lib/utils'
import { DynamicIcon } from '@renderer/components/workspace/workspace-glyph'
import { WORKSPACE_ICON_NAMES, isIconName } from './icon-catalog'

/** Icon picker — design ported 1:1 from _zinx's `icon-picker-dialog` (a field
 *  trigger + Dialog + Command search + outline-button grid with Selected/Icons
 *  sections), backed by our curated icon catalog (`WORKSPACE_ICONS`) instead of
 *  the whole Phosphor barrel. Selecting sets the icon name (e.g. "Rocket");
 *  clearing sets "". */
export function IconPickerDialog({
  selectedIcon,
  onSelect
}: {
  selectedIcon?: string
  onSelect: (iconName: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const hasSelected = isIconName(selectedIcon)
  const filteredIcons =
    search !== ''
      ? WORKSPACE_ICON_NAMES.filter((name) => name.toLowerCase().includes(search.toLowerCase()))
      : WORKSPACE_ICON_NAMES

  const handleIconSelect = (iconName: string): void => {
    onSelect(iconName)
    setOpen(false)
  }
  const handleIconDeselect = (e: React.MouseEvent): void => {
    e.stopPropagation()
    onSelect('')
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* A select-style field: left-aligned label, a leading glyph, and a trailing
          caret (or a clear button when an icon is picked) — reads like the Name
          input above it, not a centered button. */}
      <div className="relative w-full">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 pr-8 text-left text-sm shadow-xs transition-colors hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {hasSelected ? (
            <DynamicIcon name={selectedIcon} className="size-4 shrink-0 text-foreground" />
          ) : (
            <Smiley className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className={cn('min-w-0 flex-1 truncate', !hasSelected && 'text-muted-foreground')}>
            {hasSelected ? selectedIcon : 'Pick an icon…'}
          </span>
        </button>
        {/* A single trailing control at the right edge — the clear X when an icon is
            picked, otherwise a select-style caret (absolutely positioned so it sits flush
            against the edge, like a real select trigger). */}
        {hasSelected ? (
          <button
            type="button"
            title="Clear icon"
            onClick={handleIconDeselect}
            className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded hover:bg-accent"
          >
            <X className="size-3 text-muted-foreground opacity-60 hover:opacity-100" />
          </button>
        ) : (
          <CaretDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        )}
      </div>

      <DialogContent className="p-0 sm:max-w-[480px]">
        <DialogHeader className="sr-only">
          <DialogTitle>Pick an Icon</DialogTitle>
          <DialogDescription>Choose an icon from the library</DialogDescription>
        </DialogHeader>

        <Command shouldFilter={false} className="h-full">
          <CommandInput placeholder="Search icons..." value={search} onValueChange={setSearch} />
          <CommandList className="max-h-none overflow-visible p-2">
            {filteredIcons.length === 0 ? (
              <CommandEmpty>
                <div className="flex flex-col items-center gap-2 py-4">
                  <MagnifyingGlass className="size-8 text-muted-foreground" weight="duotone" />
                  <span>No icons found</span>
                </div>
              </CommandEmpty>
            ) : (
              <>
                {hasSelected ? (
                  <>
                    <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      <span>Selected</span>
                    </div>
                    <div className="pb-2">
                      <IconCell
                        name={selectedIcon as string}
                        selected
                        onSelect={handleIconSelect}
                      />
                    </div>
                  </>
                ) : null}
                <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  <span>Icons</span>
                </div>
                <div className="no-scrollbar max-h-[min(400px,50dvh)] overflow-y-auto">
                  <div className="grid grid-cols-5 gap-1.5 pb-1.5 sm:grid-cols-8">
                    {filteredIcons.map((iconName) => (
                      <IconCell
                        key={iconName}
                        name={iconName}
                        selected={selectedIcon === iconName}
                        onSelect={handleIconSelect}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

/** One icon in the grid. **Memoized + a plain `<button>`** (not shadcn's CVA
 *  `Button`, which recomputes classes for all ~350 cells on open) and
 *  `content-visibility:auto` so the browser skips rendering off-screen icons —
 *  together these make the modal open snappily instead of janking on the grid. */
const IconCell = memo(function IconCell({
  name,
  selected,
  onSelect
}: {
  name: string
  selected: boolean
  onSelect: (name: string) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={name}
      onClick={() => onSelect(name)}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '2.75rem' }}
      className={cn(
        'flex h-11 w-full items-center justify-center rounded-md border transition-colors hover:bg-accent',
        selected ? 'border-primary bg-accent text-primary' : 'border-input text-foreground'
      )}
    >
      <DynamicIcon name={name} className="size-5" />
    </button>
  )
})
