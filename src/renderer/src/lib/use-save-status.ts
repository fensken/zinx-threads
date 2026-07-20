import { useCallback, useEffect, useRef, useState } from 'react'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Track the save state of a stream of auto-save mutations, for a "Saving… / Saved" pill
 * like the page editor's. `track(promise)` wraps each mutation: while any is in flight the
 * state is `saving`; when they all settle it's `saved` (which fades back to `idle`), or
 * `error` if one rejects (errors don't auto-clear).
 */
export function useSaveStatus(): {
  state: SaveState
  track: (promise: Promise<unknown>) => Promise<unknown>
} {
  const [state, setState] = useState<SaveState>('idle')
  const pending = useRef(0)
  // Did any save in the CURRENT batch reject? Reset when a fresh batch starts (pending 0→1).
  // Without this, a later-resolving concurrent save would downgrade `error`→`saved` and the
  // pill would claim success when a save actually failed.
  const hadError = useRef(false)

  const track = useCallback(async (promise: Promise<unknown>): Promise<unknown> => {
    if (pending.current === 0) hadError.current = false
    pending.current += 1
    setState('saving')
    try {
      const result = await promise
      pending.current -= 1
      if (pending.current === 0) setState(hadError.current ? 'error' : 'saved')
      return result
    } catch (err) {
      pending.current = Math.max(0, pending.current - 1)
      hadError.current = true
      setState('error')
      throw err
    }
  }, [])

  useEffect(() => {
    if (state !== 'saved') return
    const timer = setTimeout(() => setState('idle'), 2000)
    return () => clearTimeout(timer)
  }, [state])

  return { state, track }
}
