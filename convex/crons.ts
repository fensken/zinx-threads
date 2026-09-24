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

// Enterprise message-retention: hard-delete channel messages older than each workspace's
// `messageRetentionDays` policy. No-op for workspaces without a policy. Batched +
// self-rescheduling per workspace/channel — see `retention.enforce`.
crons.daily(
  'enforce message retention',
  { hourUTC: 7, minuteUTC: 0 },
  internal.retention.enforce,
  {}
)

// Guardrail: pause any timer left running past 12h (laptop shut, went to bed) and credit at
// most that, so a forgotten clock can't invent a day of hours. Hourly so the correction is
// never far behind. Indexed range + self-rescheduling — see `timer.autoPauseStale`.
crons.hourly('auto-pause stale timers', { minuteUTC: 20 }, internal.timer.autoPauseStale, {})


export default crons
