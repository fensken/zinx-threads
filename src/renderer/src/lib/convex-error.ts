import { ConvexError } from 'convex/values'

/** Pull a **user-safe** message out of a thrown Convex error.
 *
 *  Convex only ships `ConvexError.data` to the client; a plain `Error` thrown in
 *  a function surfaces as an opaque "Server Error" (plus a request id). So our
 *  Convex functions throw `ConvexError(message)` and this reads it back.
 *
 *  Anything we don't recognise is deliberately replaced with `fallback` — we
 *  never leak stack traces, request ids, or raw error objects into the UI. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (error instanceof ConvexError) {
    const data: unknown = error.data
    if (typeof data === 'string' && data.trim()) return data
    if (data && typeof data === 'object') {
      // Rate limiter (`@convex-dev/rate-limiter`) throws `{ kind, name, retryAfter }`.
      if ('retryAfter' in data && 'name' in data) {
        const retry = (data as { retryAfter?: unknown }).retryAfter
        const seconds =
          typeof retry === 'number' && retry > 0 && retry < 60 * 60 * 1000
            ? Math.ceil(retry / 1000)
            : null
        return seconds
          ? `You're doing that too fast — try again in ${seconds}s.`
          : "You're doing that too fast — please slow down."
      }
      if ('message' in data) {
        const message = (data as { message: unknown }).message
        if (typeof message === 'string' && message.trim()) return message
      }
    }
  }
  return fallback
}
