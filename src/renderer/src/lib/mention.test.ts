import { describe, expect, it } from 'vitest'
import {
  isMentionHref,
  mentionGroup,
  mentionHref,
  parseMentionHref,
  stripMentionLinks
} from './mention'

describe('mention href round-trip', () => {
  it('builds and parses a user mention', () => {
    const href = mentionHref('user', 'abc123')
    expect(href).toBe('zinx://user/abc123')
    expect(parseMentionHref(href)).toEqual({ kind: 'user', id: 'abc123' })
  })

  it('recognises channel + group hrefs', () => {
    expect(isMentionHref('zinx://channel/c1')).toBe(true)
    expect(isMentionHref('zinx://group/everyone')).toBe(true)
  })

  it('rejects ordinary and malformed hrefs', () => {
    expect(parseMentionHref('https://example.com')).toBeNull()
    expect(parseMentionHref('zinx://bogus/x')).toBeNull()
    expect(parseMentionHref(null)).toBeNull()
    expect(isMentionHref(undefined)).toBe(false)
  })
})

describe('stripMentionLinks', () => {
  it('collapses mention links to their label', () => {
    expect(stripMentionLinks('hi [@Alice](zinx://user/x) and [#general](zinx://channel/y)')).toBe(
      'hi @Alice and #general'
    )
  })

  it('leaves ordinary links untouched', () => {
    expect(stripMentionLinks('[docs](https://example.com)')).toBe('[docs](https://example.com)')
  })
})

describe('mentionGroup', () => {
  it('resolves known groups and gates @everyone to moderators', () => {
    expect(mentionGroup('everyone')?.moderatorOnly).toBe(true)
    expect(mentionGroup('admins')?.moderatorOnly).toBe(false)
    expect(mentionGroup('nope')).toBeUndefined()
  })
})
