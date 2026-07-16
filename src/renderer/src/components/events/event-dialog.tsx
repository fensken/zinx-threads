import { useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { toast } from 'sonner'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { BusyLabel } from '@renderer/components/common/busy-label'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Textarea } from '@renderer/components/ui/textarea'
import { errorMessage } from '@renderer/lib/convex-error'
import {
  dateInputValue,
  formatTimeInZone,
  inputsToUtc,
  sameClock,
  detectTimeZone,
  zoneLabel
} from '@renderer/lib/timezone'
import type { CalendarEvent } from '@renderer/lib/calendar-grid'

const NO_CHANNEL = '__none__'

/** Reminder offsets, in minutes before the start. `'0'` is "no reminder" — and, like
 *  every sentinel in this app, it has a human label; a user never sees the `0`. */
const REMINDER_LABELS: Record<string, string> = {
  '0': 'No reminder',
  '5': '5 minutes before',
  '10': '10 minutes before',
  '30': '30 minutes before',
  '60': '1 hour before',
  '1440': '1 day before'
}

/** Create or edit an event.
 *
 *  **The form is wall-clock; the wire is UTC.** You type "9:00 on the 18th", and that
 *  is interpreted in the *workspace's* zone (`inputsToUtc`), not the browser's — which
 *  is the one conversion that matters here, and the one a naive `new Date(value)` gets
 *  silently wrong for anyone not sitting in the workspace's zone. The field shows the
 *  zone it's typing in, and echoes back what that means in your own. */
export function EventDialog({
  workspaceId,
  workspaceSlug,
  zone,
  event,
  /** Seed a new event on this day (midnight, workspace zone) — clicking a calendar cell. */
  seedAt,
  open,
  onOpenChange
}: {
  workspaceId: Id<'workspaces'>
  workspaceSlug: string
  zone: string
  /** Present → edit. Absent → create. */
  event?: CalendarEvent | null
  seedAt?: number
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const channels = useQuery(api.channels.listBySlug, open ? { slug: workspaceSlug } : 'skip')
  const create = useMutation(api.events.create)
  const update = useMutation(api.events.update)

  const base = event?.startAt ?? seedAt ?? nextHour()
  const [title, setTitle] = useState(event?.title ?? '')
  const [description, setDescription] = useState(event?.description ?? '')
  const [location, setLocation] = useState(event?.location ?? '')
  const [allDay, setAllDay] = useState(event?.allDay ?? false)
  const [date, setDate] = useState(dateInputValue(base, zone))
  const [start, setStart] = useState(timeValue(base, zone))
  const [end, setEnd] = useState(timeValue(event?.endAt ?? base + 60 * 60 * 1000, zone))
  const [channelId, setChannelId] = useState<string>(event?.channelId ?? NO_CHANNEL)
  const [reminder, setReminder] = useState<string>(String(event?.reminderMinutes ?? 10))
  const [busy, setBusy] = useState(false)

  const startAt = allDay ? inputsToUtc(date, '00:00', zone) : inputsToUtc(date, start, zone)
  const endAt = allDay ? inputsToUtc(date, '23:59', zone) : inputsToUtc(date, end, zone)
  const valid = title.trim().length > 0 && startAt !== null && endAt !== null && endAt >= startAt

  const viewer = detectTimeZone()
  const showsYourTime = !allDay && startAt !== null && !sameClock(zone, viewer, startAt)

  /** value → label. The **only** thing rendered; the id is carried as the value.
   *  The "none" sentinel gets a human label too ("No channel"), never `__none__`. */
  const channelItems: Record<string, string> = useMemo(() => {
    const map: Record<string, string> = { [NO_CHANNEL]: 'No channel' }
    for (const channel of channels ?? []) {
      if (channel.kind === 'dm') continue
      map[channel._id] = `#${channel.name}`
    }
    return map
  }, [channels])

  const submit = async (formEvent: React.FormEvent): Promise<void> => {
    formEvent.preventDefault()
    if (!valid || busy || startAt === null || endAt === null) return
    setBusy(true)
    try {
      const fields = {
        title: title.trim(),
        description: description.trim() || undefined,
        location: location.trim() || undefined,
        startAt,
        endAt,
        allDay,
        timezone: zone,
        channelId: channelId === NO_CHANNEL ? undefined : (channelId as Id<'channels'>),
        reminderMinutes: Number(reminder) || undefined
      }
      if (event) await update({ eventId: event._id, ...fields })
      else await create({ workspaceId, ...fields })
      onOpenChange(false)
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save the event'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{event ? 'Edit event' : 'New event'}</DialogTitle>
          <DialogDescription>
            Scheduled in the workspace&apos;s time zone ({zoneLabel(zone)}).
          </DialogDescription>
        </DialogHeader>

        <form
          id="event-form"
          onSubmit={submit}
          className="no-scrollbar grid min-h-0 flex-1 gap-3 overflow-y-auto py-1"
        >
          <div className="grid gap-1.5">
            <Label htmlFor="event-title">Title</Label>
            <Input
              id="event-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sprint planning"
              maxLength={120}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="event-date">Date</Label>
            <Input
              id="event-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={allDay} onCheckedChange={(next) => setAllDay(next === true)} />
            All day
          </label>

          {!allDay ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="event-start">Starts</Label>
                <Input
                  id="event-start"
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="event-end">Ends</Label>
                <Input
                  id="event-end"
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          {/* What you typed, in your own clock — so nobody schedules a 9am standup
              that turns out to be 4am for them. Only shown when the zones differ. */}
          {showsYourTime && startAt !== null && endAt !== null ? (
            <p className="text-xs text-muted-foreground">
              That&apos;s {formatTimeInZone(startAt, viewer)} – {formatTimeInZone(endAt, viewer)}{' '}
              your time.
            </p>
          ) : null}
          {endAt !== null && startAt !== null && endAt < startAt ? (
            <p className="text-xs text-destructive">The event ends before it starts.</p>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="event-location">Location</Label>
            <Input
              id="event-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Meeting room, or a link"
              maxLength={120}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Channel</Label>
            {/* `items` is what makes the TRIGGER show `#general` instead of the raw
                channel id. Base UI's `Select.Value` falls back to printing the value
                itself, so a Select whose values are ids leaks them the moment one is
                picked — see the "never expose internal ids" rule in CLAUDE.md. The id
                stays the value; only the label is ever rendered. */}
            <Select
              items={channelItems}
              value={channelId}
              onValueChange={(value) => setChannelId(value ?? NO_CHANNEL)}
            >
              <SelectTrigger>
                <SelectValue placeholder="No channel" />
              </SelectTrigger>
              <SelectContent>
                {/* DMs are absent: an event is visible to the whole workspace, a
                    conversation isn't. */}
                {Object.entries(channelItems).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Reminder</Label>
            <Select
              items={REMINDER_LABELS}
              value={reminder}
              onValueChange={(value) => setReminder(value ?? '0')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(REMINDER_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Everyone attending sees a “starting soon” banner in the app from then on.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="event-description">Description</Label>
            <Textarea
              id="event-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this about?"
              rows={3}
              maxLength={2000}
            />
          </div>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="event-form" disabled={!valid || busy}>
            <BusyLabel
              busy={busy}
              busyText="Saving…"
              idle={event ? 'Save event' : 'Create event'}
            />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** `HH:MM` for an `<input type="time">`, in the workspace's zone. */
function timeValue(at: number, zone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(at))
  return parts
}

/** A sensible default for a new event: the next full hour. */
function nextHour(): number {
  const now = new Date()
  now.setMinutes(0, 0, 0)
  return now.getTime() + 60 * 60 * 1000
}
