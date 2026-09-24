import { useEffect, useRef, useState } from 'react'

/**
 * A live elapsed time that survives a wrong clock.
 *
 * The obvious implementation — `Date.now() - segmentStartedAt`, against a `segmentStartedAt`
 * the server wrote — has a skew bug: a client whose clock is three minutes fast reads +3:00
 * the instant a timer starts, and one running behind shows a frozen or negative clock.
 * zinx-os does exactly this.
 *
 * So the server sends the elapsed time **it** computed, and this hook adds only the time
 * that has passed locally since that value arrived, measured with `performance.now()`.
 * Consequences worth stating:
 *  - the client's clock *offset* stops mattering entirely; only its rate does, and a rate
 *    error big enough to notice would break far more than a timer;
 *  - `performance.now()` is monotonic, so an NTP correction or a user changing the system
 *    clock mid-session can't make the display jump or run backwards.
 *
 * Everything impure — reading the clock, touching the anchor ref — happens inside the effect
 * and the interval callback, never during render, so the component stays a pure function of
 * its props. Each tick **recomputes** from the anchor rather than accumulating, so a tab
 * throttled in the background costs a stale pixel, never a drifted number.
 */
export function useElapsed(baseMs: number, running: boolean, tickMs = 1000): number {
  const [ticked, setTicked] = useState<number | null>(null)
  const anchor = useRef({ baseMs, at: 0 })

  useEffect(() => {
    if (!running) return
    anchor.current = { baseMs, at: performance.now() }
    const id = setInterval(() => {
      const { baseMs: base, at } = anchor.current
      setTicked(base + Math.max(0, performance.now() - at))
    }, tickMs)
    return () => clearInterval(id)
  }, [baseMs, running, tickMs])

  if (!running) return baseMs
  // Between a fresh server value arriving and the next tick, the ticked value is stale by up
  // to `tickMs`. Taking whichever is larger keeps the clock moving forwards during that
  // window instead of flicking back a second.
  return ticked !== null && ticked > baseMs ? ticked : baseMs
}
