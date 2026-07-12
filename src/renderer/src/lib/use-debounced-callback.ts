import { useCallback, useEffect, useRef } from 'react'

/** Trailing-edge debounce that **flushes on unmount**.
 *
 *  Written for page autosave: without the flush, navigating away within the
 *  debounce window silently discards the last edits — exactly the keystrokes the
 *  user cared most about.
 *
 *  `merge` combines calls that land inside one window. The default keeps the last
 *  value, which is right when each call carries the whole state (a document). It
 *  is *wrong* when calls carry partial patches — merge them, or typing a title and
 *  then picking an icon would drop the title. */
export function useDebouncedCallback<T>(
  callback: (value: T) => void,
  delayMs: number,
  merge: (previous: T, next: T) => T = (_previous, next) => next
): (value: T) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<{ value: T } | null>(null)
  // Keep the newest callback / merge without restarting the timer.
  const latest = useRef(callback)
  const combine = useRef(merge)

  useEffect(() => {
    combine.current = merge
  }, [merge])

  useEffect(() => {
    latest.current = callback
  }, [callback])

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
      if (pending.current) latest.current(pending.current.value)
    }
  }, [])

  return useCallback(
    (value: T) => {
      pending.current = pending.current
        ? { value: combine.current(pending.current.value, value) }
        : { value }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        const next = pending.current
        pending.current = null
        if (next) latest.current(next.value)
      }, delayMs)
    },
    [delayMs]
  )
}
