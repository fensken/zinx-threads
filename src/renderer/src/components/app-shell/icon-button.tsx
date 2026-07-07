import { cn } from '@renderer/lib/utils'

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
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
        active && 'bg-accent text-foreground',
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}
