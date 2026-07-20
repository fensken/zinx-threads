import { HexColorInput, HexColorPicker } from 'react-colorful'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { cn } from '@renderer/lib/utils'

/**
 * A small colour swatch that opens the app's colour picker (react-colorful — the same one
 * the page cover uses) with a row of preset swatches. Reused wherever the user picks a
 * categorical colour (e.g. a database select option's colour), so colour-picking is
 * consistent app-wide.
 */
export function ColorPickerButton({
  color,
  onChange,
  presets,
  className
}: {
  color: string
  onChange: (color: string) => void
  presets?: string[]
  className?: string
}): React.JSX.Element {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label="Pick a colour"
            className={cn('size-4 shrink-0 rounded-full ring-1 ring-border ring-inset', className)}
            style={{ backgroundColor: color }}
          />
        }
      />
      <PopoverContent align="start" className="w-auto space-y-2 p-2">
        <HexColorPicker color={color} onChange={onChange} />
        <HexColorInput
          color={color}
          onChange={onChange}
          prefixed
          className="w-full rounded-md border border-input bg-transparent px-2 py-1 text-xs uppercase outline-none focus:border-ring"
        />
        {presets && presets.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {presets.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => onChange(preset)}
                aria-label={preset}
                className={cn(
                  'size-5 rounded-full ring-1 ring-border ring-inset transition-transform hover:scale-110',
                  preset.toLowerCase() === color.toLowerCase() && 'ring-2 ring-primary'
                )}
                style={{ backgroundColor: preset }}
              />
            ))}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
