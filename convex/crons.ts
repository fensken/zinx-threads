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

// Weekly GC: reclaim R2 objects for page media that was REMOVED from a page but whose object
// lingered (a block dropped from a still-live page, so `cleanup.channel` never ran). Guarded
// hard against deleting live files — public-URL-only, a 7-day grace, and it skips any page it
// can't fully map. See `files.reconcilePageMedia`.
crons.weekly(
  'reconcile page media',
  { dayOfWeek: 'sunday', hourUTC: 9, minuteUTC: 0 },
  internal.files.reconcilePageMedia,
  {}
)

export default crons
