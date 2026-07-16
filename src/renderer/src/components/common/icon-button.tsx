import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'

/**
 * An icon-only button with a **shadcn tooltip** showing `label` (the accessible name stays
 * on `aria-label`). The app's most-used control — the channel header's actions, the nav,
 * the message row's hover toolbar and the sidebar's row buttons all go through it.
 *
 * **It IS a shadcn `Button`** (`variant="ghost"`, `size="icon"`), not a hand-rolled one. It
 * used to be a bare `<button>` carrying its own Tailwind classes, which meant its hover,
 * focus ring, disabled state and dark-mode handling drifted from every other button in the
 * app and had to be re-fixed here by hand each time the palette moved. Now it inherits all
 * of that from one place.
 *
 * `active` maps to `aria-pressed` — the correct semantics for a toggle, and what the
 * styling keys off, so there's no separate visual-state prop to keep in step.
 */
export function IconButton({
  label,
  active,
  className,
  children,
  ...props
}: {
  label: string
  active?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            aria-pressed={active}
            className={cn(
              // The one thing `ghost` leaves to the caller: the idle colour. An icon button
              // at rest is secondary — it's an affordance, not content — and lights up on
              // hover, which `ghost` already handles.
              'text-muted-foreground',
              active && 'bg-muted text-foreground',
              className
            )}
            {...props}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
