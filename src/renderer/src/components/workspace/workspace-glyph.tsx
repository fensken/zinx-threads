import { createElement } from 'react'
import type { IconWeight } from '@phosphor-icons/react'
import { cn } from '@renderer/lib/utils'
import { APP_LOGO_SRC } from '@renderer/lib/app-logo'
import { WORKSPACE_ICONS, isIconName } from '@renderer/components/pickers/icon-catalog'

/** Render a curated Phosphor icon by name (statically imported — no lazy chunks).
 *  Unknown names render nothing. */
export function DynamicIcon({
  name,
  className,
  weight
}: {
  name?: string | null
  className?: string
  weight?: IconWeight
}): React.JSX.Element | null {
  const icon = name ? WORKSPACE_ICONS[name] : undefined
  return icon ? createElement(icon, { className, weight }) : null
}

/**
 * A workspace's visual glyph — precedence: uploaded **image (logo)** → catalog
 * **icon** → the raw string (legacy 2-letter/emoji) → the **app logo**. A workspace
 * with both a logo and an icon shows the **logo**; one with neither shows the brand
 * mark rather than initials. Rendered with **no background color** for the icon/text
 * case (inherits the current text color); images fill the box. The caller owns the
 * box size/shape. `name` is kept for API compatibility (callers pass it).
 */
export function WorkspaceGlyph({
  image,
  icon,
  className,
  iconClassName = 'size-1/2'
}: {
  image?: string | null
  icon?: string | null
  name: string
  className?: string
  iconClassName?: string
}): React.JSX.Element {
  const raw = (icon ?? '').trim()
  return (
    <span className={cn('flex items-center justify-center overflow-hidden', className)}>
      {image ? (
        <img src={image} alt="" className="size-full object-cover" />
      ) : isIconName(icon) ? (
        <DynamicIcon name={icon} className={iconClassName} />
      ) : raw ? (
        <span className="font-bold">{raw}</span>
      ) : (
        <img src={APP_LOGO_SRC} alt="" className="size-full object-cover" />
      )}
    </span>
  )
}
