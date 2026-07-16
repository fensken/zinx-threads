import { BRAND } from '@shared/brand'
import { cn } from '@renderer/lib/utils'
import logoSrc from '@renderer/assets/logo.png'

/** The Zinx Threads app mark — the brand logo image, clipped to a rounded square. Imported as a
 *  module (not a `public/` path) so the URL resolves in the packaged desktop build's `file://`
 *  renderer too. Size it with `className`. */
export function Logo({ className }: { className?: string }): React.JSX.Element {
  return (
    <img src={logoSrc} alt="" aria-hidden className={cn('rounded-xl object-cover', className)} />
  )
}

/** The mark + "Zinx Threads" wordmark, for headers / sign-in. */
export function LogoWordmark({ className }: { className?: string }): React.JSX.Element {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <Logo className="size-7" />
      <span className="text-base font-bold tracking-tight">{BRAND.productName}</span>
    </span>
  )
}
