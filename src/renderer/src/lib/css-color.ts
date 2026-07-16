/**
 * Resolving a **theme token to a literal colour**, for the few APIs that can't take a CSS
 * variable — today, Excalidraw's canvas, which is painted into a bitmap rather than styled.
 *
 * The theme is the source of truth for every colour in the app. When something can't read
 * `var(--card)`, we resolve `var(--card)` and hand it the answer — we never hardcode a
 * parallel colour that would then drift the moment the palette changes.
 */

/**
 * Any CSS colour → `[r, g, b]` in **gamma-encoded sRGB, 0–1**.
 *
 * **Must not assume `rgb()`.** Our palette is authored in `oklch`, and Chrome's
 * `getComputedStyle` *preserves the authored colour space* — it hands back
 * `oklch(0.953 0.0156 86.4)`, not `rgb(…)`. An `rgb()`-only parser returns null for every
 * colour in the app.
 *
 * So let the browser do the conversion: paint onto a 1×1 canvas and read the bytes back.
 * It resolves anything CSS can express, in any colour space, without this file knowing what
 * a colour space is.
 */
export function cssColorToRgb(color: string): [number, number, number] | null {
  const value = color.trim()
  if (!value) return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null

    // An unparseable colour leaves `fillStyle` at its default and would silently paint
    // black, so check the canvas actually accepted it.
    ctx.fillStyle = '#ffffff'
    ctx.fillStyle = value
    if (ctx.fillStyle === '#ffffff' && !/^(#ffffff|#fff|white)$/i.test(value)) return null
    ctx.fillRect(0, 0, 1, 1)

    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return [r / 255, g / 255, b / 255]
  } catch {
    return null
  }
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const channel = (v: number): string =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** A theme token (`--card`, `--foreground`, …) as gamma-encoded sRGB. */
export function themeRgb(token: string): [number, number, number] | null {
  const value = getComputedStyle(document.documentElement).getPropertyValue(token)
  return cssColorToRgb(value)
}
