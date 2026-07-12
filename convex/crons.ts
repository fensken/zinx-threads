import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

// Sweep R2 objects that were uploaded but never attached to anything (abandoned
// composer drafts, closed tabs). Daily, off-peak — see `files.sweepOrphanUploads`.
crons.daily('sweep orphan uploads', { hourUTC: 8, minuteUTC: 0 }, internal.files.sweepOrphanUploads)

// Retention: prune Inbox notifications past their TTL (the only unboundedly-growing
// table). Batched + self-rescheduling — see `cleanup.sweepNotifications`.
crons.daily(
  'prune old notifications',
  { hourUTC: 8, minuteUTC: 30 },
  internal.cleanup.sweepNotifications
)

export default crons
