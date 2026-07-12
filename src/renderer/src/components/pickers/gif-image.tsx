import { cn } from '@renderer/lib/utils'

function isKlipyUrl(src: string): boolean {
  try {
    return new URL(src).hostname.includes('klipy.com')
  } catch {
    return false
  }
}

/** Renders a sent GIF with the KLIPY attribution mark overlaid when the media is
 *  served from KLIPY (required by their API terms). Ported from zinx-os. */
export function GifImage({
  src,
  className
}: {
  src: string
  className?: string
}): React.JSX.Element {
  return (
    <span className="relative inline-block">
      <img
        src={src}
        alt="GIF"
        className={cn('max-h-64 w-fit max-w-full rounded-md object-contain sm:max-w-sm', className)}
      />
      {isKlipyUrl(src) ? (
        <span className="pointer-events-none absolute right-1 bottom-1 rounded bg-black/60 px-1 py-px text-[9px] font-semibold tracking-wide text-white uppercase">
          via KLIPY
        </span>
      ) : null}
    </span>
  )
}
