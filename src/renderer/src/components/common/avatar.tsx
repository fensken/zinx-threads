import { cn } from '@renderer/lib/utils'
import type { Presence } from '@renderer/lib/user-status'
import { PresenceDot } from '@renderer/components/common/presence-dot'

/** Used when a user row carries no assigned color (categorical — the sanctioned
 *  hardcoded-color exception). */
export const FALLBACK_AVATAR_COLOR = '#5865f2'

export function Avatar({
  initials,
  color,
  image,
  className,
  presence,
  ringClassName = 'ring-2 ring-background'
}: {
  initials: string
  color: string
  /** Photo URL (Google/upload). When set it covers the colored-initials fallback. */
  image?: string | null
  className?: string
  presence?: Presence
  ringClassName?: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white',
        className
      )}
      style={image ? undefined : { backgroundColor: color }}
    >
      {image ? (
        <img
          src={image}
          alt=""
          className="absolute inset-0 size-full rounded-[inherit] object-cover"
        />
      ) : (
        initials
      )}
      {presence ? (
        <PresenceDot
          presence={presence}
          className={cn('absolute -right-0.5 -bottom-0.5 size-3', ringClassName)}
        />
      ) : null}
    </span>
  )
}
