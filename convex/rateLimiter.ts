import { RateLimiter, MINUTE, HOUR, SECOND } from '@convex-dev/rate-limiter'
import { components } from './_generated/api'

/**
 * Application-layer, per-user rate limits (`@convex-dev/rate-limiter`). These are the
 * endpoints where abuse costs real money or reputation, or is spammy — NOT a defense
 * against network-layer DDoS. Every limit is keyed by the caller's identity, so one
 * user can't starve everyone else, and evaluation is transactional (a limited call
 * that later throws rolls the token back).
 *
 * `token bucket` = sustained `rate`/`period` with a `capacity` burst; `fixed window` =
 * a hard count per window. Tune here.
 */
export const rateLimiter = new RateLimiter(components.rateLimiter, {
  // Paid third-party quota spent with our server keys (Unsplash / KLIPY free tiers) —
  // "search-as-you-type" is bursty, so allow a healthy burst but cap the sustained rate.
  unsplash: { kind: 'token bucket', rate: 40, period: MINUTE, capacity: 40 },
  gifSearch: { kind: 'token bucket', rate: 40, period: MINUTE, capacity: 40 },

  // Sends a real transactional email (Resend) → costs money + is a spam/reputation
  // vector. Deliberately tight.
  channelShareInvite: { kind: 'token bucket', rate: 15, period: HOUR, capacity: 15 },

  // Creating workspaces / invite links — bot-signup + spam deterrent.
  createWorkspace: { kind: 'fixed window', rate: 15, period: HOUR },
  createInvite: { kind: 'token bucket', rate: 30, period: HOUR, capacity: 30 },

  // Anti-spam on the hottest write. Generous enough that normal typing AND a durable
  // outbox draining a backlog of queued messages never trip it — only egregious spam
  // (sustained >2/s) does.
  sendMessage: { kind: 'token bucket', rate: 120, period: MINUTE, capacity: 60 }
})

// Re-export the time units so callers can express one-off configs consistently.
export { MINUTE, HOUR, SECOND }
