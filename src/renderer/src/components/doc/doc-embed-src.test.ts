import { describe, expect, it } from 'vitest'
import { toProviderSrc } from '@renderer/components/doc/doc-embed-src'

describe('toProviderSrc', () => {
  it('accepts every YouTube URL shape', () => {
    const expected = 'youtube/dQw4w9WgXcQ'
    expect(toProviderSrc('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(expected)
    expect(toProviderSrc('https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=30s')).toBe(expected)
    expect(toProviderSrc('https://youtu.be/dQw4w9WgXcQ')).toBe(expected)
    expect(toProviderSrc('https://youtu.be/dQw4w9WgXcQ?t=12')).toBe(expected)
    expect(toProviderSrc('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(expected)
    expect(toProviderSrc('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(expected)
    expect(toProviderSrc('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBe(expected)
  })

  it('accepts Vimeo, taking the numeric id', () => {
    expect(toProviderSrc('https://vimeo.com/76979871')).toBe('vimeo/76979871')
    expect(toProviderSrc('https://player.vimeo.com/video/76979871')).toBe('vimeo/76979871')
    // An unlisted link carries a hash after the id — the id is still the numeric segment.
    expect(toProviderSrc('https://vimeo.com/76979871/abc123def')).toBe('vimeo/76979871')
  })

  it('refuses anything else — the embed block frames third-party content', () => {
    // The allow-list is the security boundary: without it one author could frame an
    // arbitrary page for everyone with access to the channel.
    expect(toProviderSrc('https://example.com/video.mp4')).toBeNull()
    expect(toProviderSrc('https://evil.example/embed/x')).toBeNull()
    // A non-http scheme parses as a URL, so the protocol check has to be explicit.
    expect(toProviderSrc('javascript:alert(1)')).toBeNull()
    expect(toProviderSrc('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(toProviderSrc('not a url')).toBeNull()
    expect(toProviderSrc('')).toBeNull()
  })
})
