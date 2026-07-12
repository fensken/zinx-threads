import { describe, expect, it } from 'vitest'
import { buildMessageRows, type MessageRowEntry } from './message-rows'

const BASE = Date.UTC(2026, 0, 15, 12, 0, 0) // noon UTC — ± minutes stays same day everywhere

interface M {
  _id: string
  authorId: string
  createdAt: number
  replyToId?: string
}

const msg = (i: number, over: Partial<M> = {}): M => ({
  _id: `m${i}`,
  authorId: 'a',
  createdAt: BASE + i * 1000,
  ...over
})

/** The `grouped` flag of each `msg` row, in order (day dividers dropped). */
const groupedFlags = (rows: MessageRowEntry<M>[]): boolean[] =>
  rows.flatMap((row) => (row.type === 'msg' ? [row.grouped] : []))

describe('buildMessageRows', () => {
  it('returns an empty list for undefined or empty input', () => {
    expect(buildMessageRows<M>(undefined)).toEqual([])
    expect(buildMessageRows<M>([])).toEqual([])
  })

  it('starts with a day divider then an ungrouped first message', () => {
    const rows = buildMessageRows([msg(0)])
    expect(rows[0]).toMatchObject({ type: 'day' })
    expect(rows[1]).toMatchObject({ type: 'msg', grouped: false })
  })

  it('caps a same-author run at 8 (one header + seven grouped), then a new header', () => {
    const rows = buildMessageRows(Array.from({ length: 9 }, (_, i) => msg(i)))
    // 1 header, 7 grouped, then the 9th message forces a fresh header.
    expect(groupedFlags(rows)).toEqual([false, true, true, true, true, true, true, true, false])
  })

  it('breaks grouping when the author changes', () => {
    const rows = buildMessageRows([msg(0), msg(1, { authorId: 'b' })])
    expect(groupedFlags(rows)).toEqual([false, false])
  })

  it('breaks grouping after a gap longer than five minutes', () => {
    const rows = buildMessageRows([
      msg(0),
      { _id: 'm1', authorId: 'a', createdAt: BASE + 6 * 60 * 1000 }
    ])
    expect(groupedFlags(rows)).toEqual([false, false])
  })

  it('always starts a fresh row for a reply (its quote needs a header)', () => {
    const rows = buildMessageRows([msg(0), msg(1, { replyToId: 'x' })])
    expect(groupedFlags(rows)).toEqual([false, false])
  })

  it('inserts a second day divider across calendar days', () => {
    const rows = buildMessageRows([
      msg(0),
      { _id: 'm1', authorId: 'a', createdAt: BASE + 48 * 3600 * 1000 }
    ])
    expect(rows.filter((row) => row.type === 'day')).toHaveLength(2)
    // The message after the divider can't group onto one from a different day.
    expect(groupedFlags(rows)).toEqual([false, false])
  })
})
