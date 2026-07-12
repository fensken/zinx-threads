import { useId } from 'react'

// Phosphor's `Headphones` (regular, 256 viewBox) — no `HeadphonesSlash` ships, so we
// draw the slash ourselves. Path lifted verbatim from @phosphor-icons/react.
const HEADPHONES_PATH =
  'M201.89,54.66A103.43,103.43,0,0,0,128.79,24H128A104,104,0,0,0,24,128v56a24,24,0,0,0,24,24H64a24,24,0,0,0,24-24V144a24,24,0,0,0-24-24H40.36A88,88,0,0,1,128,40h.67a87.71,87.71,0,0,1,87,80H192a24,24,0,0,0-24,24v40a24,24,0,0,0,24,24h16a24,24,0,0,0,24-24V128A103.41,103.41,0,0,0,201.89,54.66ZM64,136a8,8,0,0,1,8,8v40a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V136Zm152,48a8,8,0,0,1-8,8H192a8,8,0,0,1-8-8V144a8,8,0,0,1,8-8h24Z'

// The diagonal slash — same top-left→bottom-right line + ~16-wide rounded stroke as
// Phosphor's `MicrophoneSlash` / `VideoCameraSlash`, so deafen reads as one family.
const SLASH = { x1: 54, y1: 44, x2: 214, y2: 216 }

/** The deafen icon = Phosphor `Headphones` (Discord's metaphor) with a slash cut in
 *  the SAME style as `MicrophoneSlash` — a real integrated slash with a transparent
 *  gap (via an SVG mask), not a flat drawn line. `currentColor`, so it inherits the
 *  button's red/neutral like the mic + camera icons. */
export function DeafenGlyph({
  deafened,
  className
}: {
  deafened: boolean
  className?: string
}): React.JSX.Element {
  // Unique per instance (several render at once); colons from useId break url(#…).
  const maskId = `deafen-cut-${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  return (
    <svg viewBox="0 0 256 256" className={className} fill="currentColor" aria-hidden="true">
      {deafened ? (
        <>
          {/* White = keep, black = erase: the wide black line carves the gap the
              thinner visible slash sits in, matching Phosphor's cut-through look. */}
          <mask id={maskId}>
            <rect width="256" height="256" fill="white" />
            <line
              x1={SLASH.x1}
              y1={SLASH.y1}
              x2={SLASH.x2}
              y2={SLASH.y2}
              stroke="black"
              strokeWidth={30}
              strokeLinecap="round"
            />
          </mask>
          <path d={HEADPHONES_PATH} mask={`url(#${maskId})`} />
          <line
            x1={SLASH.x1}
            y1={SLASH.y1}
            x2={SLASH.x2}
            y2={SLASH.y2}
            stroke="currentColor"
            strokeWidth={16}
            strokeLinecap="round"
          />
        </>
      ) : (
        <path d={HEADPHONES_PATH} />
      )}
    </svg>
  )
}
