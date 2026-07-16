import { useMemo, useState } from 'react'
import { CaretUpDown, Check, MagnifyingGlass } from '@phosphor-icons/react'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { allTimeZones, safeZone, zoneLabel, zoneOffsetLabel } from '@renderer/lib/timezone'
import { cn } from '@renderer/lib/utils'

/** Pick an IANA time zone. A searchable list rather than a `<select>`: there are
 *  ~400 of them, and nobody scrolls to `Pacific/Kiritimati`.
 *
 *  Only zones the runtime actually knows are offered (`Intl.supportedValuesOf`), so
 *  a stored value can never be one that makes every later `Intl` call throw. Each
 *  row shows its **current** offset, which is computed live — so it's already
 *  DST-correct, and two zones that look interchangeable can be told apart. */
export function TimezoneSelect({
  value,
  onChange,
  disabled,
  className
}: {
  value: string | undefined
  onChange: (zone: string) => void
  disabled?: boolean
  className?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const zones = useMemo(() => allTimeZones(), [])
  const current = safeZone(value)

  const matches = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return zones
    return zones.filter((zone) => zone.toLowerCase().includes(term))
  }, [zones, query])

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-md border bg-transparent px-2.5 text-left text-sm transition-colors hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-60',
          className
        )}
      >
        <span className="min-w-0 flex-1 truncate">{zoneLabel(current)}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{zoneOffsetLabel(current)}</span>
        <CaretUpDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[min(24rem,90dvw)] p-0">
        <div className="flex h-9 items-center gap-2 border-b px-2.5">
          <MagnifyingGlass className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search time zones"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        {/* A fixed height, so the popover doesn't resize on every keystroke as the
            list narrows (same rule as the ⌘K palette). */}
        <div className="no-scrollbar h-64 overflow-y-auto p-1">
          {matches.length === 0 ? (
            <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
              No zone matches that.
            </p>
          ) : (
            matches.map((zone) => (
              <button
                key={zone}
                type="button"
                onClick={() => {
                  onChange(zone)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent"
              >
                <span className="min-w-0 flex-1 truncate">{zoneLabel(zone)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {zoneOffsetLabel(zone)}
                </span>
                {zone === current ? (
                  <Check className="size-4 shrink-0 text-primary" weight="bold" />
                ) : null}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
