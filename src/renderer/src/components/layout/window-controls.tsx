import { useEffect, useState } from 'react'
import { platform, windowControlsStyle } from '@renderer/lib/platform'
import { cn } from '@renderer/lib/utils'

/**
 * Minimise / maximise / close, drawn by us.
 *
 * **Windows and Linux only.** On macOS this renders nothing — the native traffic lights
 * stay, and are never reimplemented (see `windowControlsStyle`). On web there is no
 * title bar at all.
 *
 * The metrics are Windows': **46px wide, full bar height, square corners, hairline
 * glyphs**, flush to the top-right corner with no gap. That's deliberate even though the
 * colours are ours — the *shape* of these buttons is what makes them read as window
 * controls rather than as toolbar icons, and it's the same shape Discord and VS Code
 * keep. Only the palette is themed.
 *
 * Close is the one exception to "everything is a theme token": it goes **red on hover**,
 * because that convention is near-universal (Windows, and every app that draws its own)
 * and it is the one irreversible control on the bar. It uses `--destructive`, so it's
 * still the app's red, not a hardcoded one.
 */
export function WindowControls(): React.JSX.Element | null {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    if (windowControlsStyle !== 'custom') return
    void platform.windowControls.isMaximized().then(setMaximized)
    // Pushed from main, not tracked from our own clicks: the window is also maximised by
    // double-clicking the drag region, by Win+Up, by a snap gesture, and by the window
    // manager. A button that only knew about its own presses would show the wrong glyph
    // almost immediately.
    return platform.windowControls.onMaximizeChange(setMaximized)
  }, [])

  if (windowControlsStyle !== 'custom') return null

  return (
    // `app-no-drag` — these sit inside the bar's drag region, and a drag region eats the
    // click of anything that doesn't opt out.
    <div className="app-no-drag flex h-full shrink-0 self-stretch">
      <ControlButton label="Minimise" onClick={() => platform.windowControls.minimize()}>
        {/* A single line, drawn at the vertical centre. */}
        <path d="M0 5.5h10" />
      </ControlButton>

      <ControlButton
        label={maximized ? 'Restore' : 'Maximise'}
        onClick={() => platform.windowControls.toggleMaximize()}
      >
        {maximized ? (
          // Restore: the Windows "two overlapping frames" glyph.
          <>
            <path d="M2.5 2.5V0.5h7.5v7.5H8" />
            <rect x="0.5" y="2.5" width="7.5" height="7.5" />
          </>
        ) : (
          <rect x="0.5" y="0.5" width="9.5" height="9.5" />
        )}
      </ControlButton>

      <ControlButton
        label="Close"
        onClick={() => platform.windowControls.close()}
        className="hover:bg-destructive hover:text-white"
      >
        <path d="M0.5 0.5l9.5 9.5M10 0.5L0.5 10" />
      </ControlButton>
    </div>
  )
}

function ControlButton({
  label,
  onClick,
  className,
  children
}: {
  label: string
  onClick: () => void
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        // 46px is the Windows caption-button width. Fixed px, not rem: these are window
        // chrome and should not grow with the app's UI-scale setting — the bar's height
        // does, which is why the height is `self-stretch` rather than a number.
        'flex w-[46px] items-center justify-center text-muted-foreground transition-colors',
        'hover:bg-titlebar-accent hover:text-foreground',
        'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
        className
      )}
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10.5 10.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        // Crisp 1px strokes: these glyphs are drawn on a pixel grid, and anti-aliasing
        // them into a soft grey is exactly what makes hand-drawn controls look cheap.
        shapeRendering="crispEdges"
        aria-hidden
      >
        {children}
      </svg>
    </button>
  )
}
