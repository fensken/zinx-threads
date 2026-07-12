import { defineApp } from 'convex/server'
import r2 from '@convex-dev/r2/convex.config'
import resend from '@convex-dev/resend/convex.config'
import presence from '@convex-dev/presence/convex.config'
import rateLimiter from '@convex-dev/rate-limiter/convex.config'

// The app's Convex components:
//  • `@convex-dev/r2` — Cloudflare R2 file uploads (see `convex/files.ts`).
//  • `@convex-dev/resend` — transactional email (invites); wrapper in `convex/resend.ts`.
//    Reads `RESEND_API_KEY` (+ optional `RESEND_WEBHOOK_SECRET`) from the deployment env.
//  • `@convex-dev/presence` — online/offline liveness (heartbeat-based, no polling);
//    wrapper in `convex/presence.ts`. Layered under the user's manual status.
//  • `@convex-dev/rate-limiter` — per-user limits on paid/abusable endpoints (paid
//    3rd-party actions, email-sending invites, spammy creates); see `convex/rateLimiter.ts`.
const app = defineApp()
app.use(r2)
app.use(resend)
app.use(presence)
app.use(rateLimiter)

export default app
