import { describe, expect, it } from 'vitest'
import {
  decimalHours,
  formatCompact,
  formatHm,
  formatHms
} from '@renderer/components/timer/format-duration'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

describe('formatting a duration', () => {
  it('renders a running clock with stable width', () => {
    expect(formatHms(0)).toBe('00:00:00')
    expect(formatHms(5_000)).toBe('00:00:05')
    expect(formatHms(65 * MINUTE + 4_000)).toBe('01:05:04')
    // Past a day it keeps counting rather than wrapping — a 30h timer is a bug the user
    // needs to SEE, not one the formatter should hide.
    expect(formatHms(30 * HOUR)).toBe('30:00:00')
  })

  it('drops seconds once time is logged', () => {
    expect(formatHm(45 * MINUTE)).toBe('45m')
    expect(formatHm(HOUR)).toBe('1h 00m')
    expect(formatHm(3 * HOUR + 5 * MINUTE)).toBe('3h 05m')
    expect(formatCompact(3 * HOUR)).toBe('3h')
    expect(formatCompact(3 * HOUR + 5 * MINUTE)).toBe('3h 5m')
  })

  it('emits decimal hours for billing', () => {
    expect(decimalHours(HOUR)).toBe('1.00')
    expect(decimalHours(90 * MINUTE)).toBe('1.50')
    expect(decimalHours(20 * MINUTE)).toBe('0.33')
  })

  it('never renders a negative duration', () => {
    expect(formatHms(-5000)).toBe('00:00:00')
    expect(formatHm(-5000)).toBe('0m')
    expect(decimalHours(-HOUR)).toBe('0.00')
  })
})
