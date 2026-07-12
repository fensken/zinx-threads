import { describe, expect, it } from 'vitest'
import { gifSrc, messagePreview } from './message-preview'

describe('gifSrc', () => {
  it('returns the url when the whole body is a single image', () => {
    expect(gifSrc('![gif](https://x/y.gif)')).toBe('https://x/y.gif')
  })

  it('returns null when there is surrounding text', () => {
    expect(gifSrc('hi ![gif](https://x/y.gif)')).toBeNull()
  })
})

describe('messagePreview', () => {
  it('labels an image-only body as a GIF', () => {
    expect(messagePreview('![gif](https://x/y.gif)')).toEqual({ isGif: true, text: 'GIF' })
  })

  it('labels a sticker by its alt text', () => {
    expect(messagePreview('![sticker](https://x/y.webp)')).toEqual({ isGif: true, text: 'Sticker' })
  })

  it('strips emphasis + code markers to plain text', () => {
    expect(messagePreview('**bold** _em_ `code`')).toEqual({ isGif: false, text: 'bold em code' })
  })

  it('reduces a link to its label', () => {
    expect(messagePreview('see [docs](https://x)')).toEqual({ isGif: false, text: 'see docs' })
  })

  it('replaces a fenced code block with a placeholder', () => {
    expect(messagePreview('```\ncode\n```').text).toContain('code')
  })

  it('is not fooled into a GIF chip when text follows the image', () => {
    expect(messagePreview('look ![gif](https://x/y.gif)').isGif).toBe(false)
  })
})
