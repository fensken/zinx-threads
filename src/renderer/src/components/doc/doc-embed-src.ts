/**
 * Turn a YouTube/Vimeo watch URL into the provider source Vidstack understands, or `null`
 * when the link is neither.
 *
 * Deliberately an allow-list of two. An embed block renders third-party content inside our
 * document, so "paste any URL" would let one author frame arbitrary pages for everyone with
 * access to the channel — and the fallback (a plain link the reader chooses to open) is a
 * perfectly good answer for anything else.
 *
 * Its own module rather than living beside `EmbedNode`: a file that exports components must
 * export only components, or fast refresh stops working for it.
 */
export function toProviderSrc(raw: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return null
  }
  // A `javascript:` or `data:` URL parses fine — the scheme check is the guard, not the
  // hostname match below (an unknown scheme has no hostname and would fall through).
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null

  const host = parsed.hostname.replace(/^(www\.|m\.)/, '')

  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    // `watch?v=`, plus the three path forms YouTube also serves: /embed/, /shorts/, /v/.
    const id =
      parsed.searchParams.get('v') ??
      parsed.pathname.match(/\/(?:embed|shorts|v)\/([\w-]+)/)?.[1] ??
      null
    return id ? `youtube/${id}` : null
  }
  if (host === 'youtu.be') {
    const id = parsed.pathname.slice(1).split('/')[0]
    return id ? `youtube/${id}` : null
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    // Vimeo ids are numeric; `/video/123` and `/123` both appear, so take the first numeric
    // segment rather than the last one (which can be an unlisted-video hash).
    const id = parsed.pathname
      .split('/')
      .filter(Boolean)
      .find((segment) => /^\d+$/.test(segment))
    return id ? `vimeo/${id}` : null
  }

  return null
}
