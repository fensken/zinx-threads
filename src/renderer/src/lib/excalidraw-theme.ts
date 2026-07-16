import { rgbToHex, themeRgb } from '@renderer/lib/css-color'

/**
 * The canvas background Excalidraw should be given, so that what you *see* is our theme's
 * `--card` — the same surface every other channel renders on.
 *
 * ## Why this isn't just `themeRgb('--card')`
 *
 * Excalidraw's dark mode is not a dark palette. It renders the scene in **light** colours
 * and then inverts the whole canvas with a CSS filter:
 *
 *     .excalidraw.theme--dark { --theme-filter: invert(93%) hue-rotate(180deg); }
 *
 * That's how a black stroke becomes a white one. It also means **anything we put on the
 * canvas comes back flipped**: hand it our dark `--card` and it appears as a pale grey (the
 * first attempt at this did exactly that, and inverted every shape's colour with it).
 *
 * The naive conclusions are both wrong:
 *  - "Let Excalidraw own the canvas" → you get a stark white board inside a cream app, and
 *    it stays white forever regardless of the theme.
 *  - "Turn the filter off" → the scene's own colours are authored *light* (a `#1e1e1e`
 *    stroke), so without the inversion every drawing is invisible on a dark background.
 *
 * The filter is **invertible**, so compute the pre-image: the colour which, after Excalidraw
 * applies its filter, lands exactly on our token. The theme stays the source of truth, and
 * the drawing still renders correctly, because we changed the *input*, not the pipeline.
 *
 * ## The maths
 *
 * CSS filters compose left-to-right on gamma-encoded sRGB, so the pipeline is
 * `hueRotate180(invert93(c))`. Inverting it:
 *
 *     preimage(target) = invert93⁻¹( hueRotate180⁻¹(target) )
 *                      = invert93⁻¹( hueRotate180(target) )     // a 180° rotation is its own inverse
 *
 * `invert(a)` is affine — `c' = c·(1 − 2a) + a` — so `invert(a)⁻¹(v) = (a − v) / (2a − 1)`.
 */

/** Excalidraw's own value. If they change it, this is the one number to update. */
const INVERT = 0.93

/**
 * The CSS `hue-rotate(180deg)` matrix, per the filter-effects spec, evaluated at 180°
 * (cos = −1, sin = 0). It's its own inverse.
 *
 * Note each row sums to 1, so a **grey maps to itself** — which is why this step is a no-op
 * for the neutral surfaces our dark palettes use today. It's here so that a future theme
 * with a *tinted* dark surface still lands on the right colour rather than a hue-shifted
 * one.
 */
function hueRotate180([r, g, b]: [number, number, number]): [number, number, number] {
  return [
    -0.574 * r + 1.43 * g + 0.144 * b,
    0.426 * r + 0.43 * g + 0.144 * b,
    0.426 * r + 1.43 * g - 0.856 * b
  ]
}

/** Undo `invert(INVERT)` on one channel. */
function unInvert(v: number): number {
  const result = (INVERT - v) / (2 * INVERT - 1)
  return Math.min(1, Math.max(0, result))
}

/**
 * The hex to hand Excalidraw's `appState.viewBackgroundColor`.
 *
 * Returns `null` if the token can't be resolved, in which case the caller should leave
 * Excalidraw's default alone rather than guess.
 */
export function canvasBackground(isDark: boolean): string | null {
  // The surface every other channel's content sits on — so a whiteboard reads as part of
  // the app rather than as an embedded white page.
  const target = themeRgb('--card')
  if (!target) return null

  // Light mode: no filter, so the colour we pass is the colour you see.
  if (!isDark) return rgbToHex(target)

  // Dark mode: pass the pre-image, so the filter lands *on* the target.
  const rotated = hueRotate180(target)
  return rgbToHex([unInvert(rotated[0]), unInvert(rotated[1]), unInvert(rotated[2])])
}
