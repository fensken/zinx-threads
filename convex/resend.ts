import { Resend } from '@convex-dev/resend'
import { components } from './_generated/api'
import { BRAND } from './lib/brand'

// Transactional email via the `@convex-dev/resend` component (registered in
// convex.config.ts). Reads `RESEND_API_KEY` from the deployment env. `testMode: false`
// sends for real (the component defaults to test mode, which only delivers to verified
// addresses). Emails are enqueued transactionally from mutations — see `convex/email.ts`.
//
// The sending domain (`zinx.app`) is verified under the Resend account this key belongs
// to; keep the `from` address on that domain. Delivery-event tracking (the webhook +
// `onEmailEvent`) is a follow-up — sending doesn't need it.
export const resend: Resend = new Resend(components.resend, { testMode: false })

/** Sender address — read from the `EMAIL_FROM` deployment env var so the from-name and
 *  domain are configurable per deployment. Must be on the Resend-verified domain; falls
 *  back to the shared account's verified `zinx.app` sender. */
export const EMAIL_FROM = process.env.EMAIL_FROM ?? `${BRAND.productName} <contact@zinx.app>`
