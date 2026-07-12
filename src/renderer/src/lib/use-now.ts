import { useEffect, useState } from 'react'

/** A `Date` that ticks, so relative labels ("Now", "5m", "3h") stay truthful.
 *
 *  `_zinx` freezes `now` at mount (`useState(() => new Date())`), which leaves a
 *  message reading "Now" long after it was sent. Re-rendering the list once a
 *  half-minute is cheap; being wrong about the time isn't. */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])

  return now
}
