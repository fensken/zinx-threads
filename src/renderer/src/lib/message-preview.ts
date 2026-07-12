/** A one-line, plain-text preview of a Markdown message body — used by the reply
 *  quote and the reply-target chip.
 *
 *  `_zinx` sniffs GIF *URLs* because it stores bare links; our composer stores an
 *  image node (`![gif](url)`), so we detect that instead. */
const IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g

/** If the whole message is a single image (a sent GIF), return its URL.
 *  `_zinx` branches its edit UI on exactly this test — a GIF message gets a
 *  "change the GIF" editor rather than a text editor. */
export function gifSrc(body: string): string | null {
  const match = body.trim().match(/^!\[[^\]]*\]\(([^)\s]+)\)$/)
  return match ? match[1] : null
}

export function messagePreview(body: string): { isGif: boolean; text: string } {
  const trimmed = body.trim()

  // A message that is *only* image(s) — e.g. a sent GIF or sticker — reads as a
  // chip. (`_zinx` sniffs bare GIF URLs; our composer stores an image node whose
  // alt — `gif` / `sticker` — labels the chip.)
  const hasImage = IMAGE_RE.test(trimmed)
  IMAGE_RE.lastIndex = 0
  if (hasImage && !trimmed.replace(IMAGE_RE, '').trim()) {
    return { isGif: true, text: /^!\[sticker\]/i.test(trimmed) ? 'Sticker' : 'GIF' }
  }

  const text = trimmed
    .replace(/```[\s\S]*?```/g, ' code ') // fenced code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' image ') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → their text
    .replace(/^\s{0,3}[>#]+\s?/gm, '') // quote / heading markers
    .replace(/[*_~`\\]/g, '') // emphasis + escapes
    .replace(/\s+/g, ' ')
    .trim()

  return { isGif: false, text }
}
