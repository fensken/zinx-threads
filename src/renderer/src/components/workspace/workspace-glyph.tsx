import { createElement } from 'react'
import type { IconWeight } from '@phosphor-icons/react'
import { cn } from '@renderer/lib/utils'
import { WORKSPACE_ICONS, isIconName } from '@renderer/components/pickers/icon-catalog'

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

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
 * **icon** → the raw string (legacy 2-letter/emoji) → **initials** of the name.
 * A workspace with both a logo and an icon shows the **logo**. Rendered with
 * **no background color** for the icon/text case (inherits the current text
 * color); the image fills the box. The caller owns the box size/shape.
 */
export function WorkspaceGlyph({
  image,
  icon,
  name,
  className,
  iconClassName = 'size-1/2'
}: {
  image?: string | null
  icon?: string | null
  name: string
  className?: string
  iconClassName?: string
}): React.JSX.Element {
  const text = (icon ?? '').trim() || initialsOf(name)
  return (
    <span className={cn('flex items-center justify-center overflow-hidden', className)}>
      {image ? (
        <img src={image} alt="" className="size-full object-cover" />
      ) : isIconName(icon) ? (
        <DynamicIcon name={icon} className={iconClassName} />
      ) : (
        <span className="font-bold">{text}</span>
      )}
    </span>
  )
}
