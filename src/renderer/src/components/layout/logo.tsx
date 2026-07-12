import { cn } from '@renderer/lib/utils'

/** The Zinx Threads app mark — a rounded-square badge in the brand/primary color
 *  with a contrasting "Z". Themed via `bg-primary` / `text-primary-foreground` so
 *  it follows the active theme (light/dark). Size it with `className`. */
export function Logo({ className }: { className?: string }): React.JSX.Element {
  return (
    <span
      className={cn(
        'flex items-center justify-center rounded-xl bg-primary text-primary-foreground',
        className
      )}
    >
      <svg viewBox="0 0 32 32" fill="none" className="size-[62%]" aria-hidden>
        <path
          d="M11 11.5H21L11 20.5H21"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

/** The mark + "Zinx Threads" wordmark, for headers / sign-in. */
export function LogoWordmark({ className }: { className?: string }): React.JSX.Element {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <Logo className="size-7" />
      <span className="text-base font-bold tracking-tight">Zinx Threads</span>
    </span>
  )
}
