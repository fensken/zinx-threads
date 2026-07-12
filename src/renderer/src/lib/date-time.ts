import { differenceInHours, differenceInMinutes, format, isSameDay, subDays } from 'date-fns'

// Ported from `_zinx`'s `utils/dateAndTime.ts`. Every helper takes `now` rather
// than calling `Date.now()` internally, so it stays pure and testable.

function isToday(date: Date, now: Date): boolean {
  return isSameDay(date, now)
}

function isYesterday(date: Date, now: Date): boolean {
  return isSameDay(date, subDays(now, 1))
}

/** The compact time next to a message: `Now` · `5m` · `3h` · `Yday` · `Jul 8`. */
export function formatTimestamp(timestamp: number, now: Date): string {
  const date = new Date(timestamp)
  const minutes = differenceInMinutes(now, date)
  const hours = differenceInHours(now, date)

  if (minutes < 1) return 'Now'
  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h`
  if (isYesterday(date, now)) return 'Yday'
  return format(date, 'MMM d')
}

/** The exact time, shown on hover: `Wednesday, July 8, 2026 at 12:21 AM`. */
export function formatFullTimestamp(timestamp: number): string {
  return format(new Date(timestamp), "EEEE, MMMM d, yyyy 'at' h:mm a")
}

/** The day divider: `Today` · `Yesterday` · `Wednesday, July 8, 2026`. */
export function formatDateSeparator(timestamp: number, now: Date): string {
  const date = new Date(timestamp)
  if (isToday(date, now)) return 'Today'
  if (isYesterday(date, now)) return 'Yesterday'
  return format(date, 'EEEE, MMMM d, yyyy')
}
