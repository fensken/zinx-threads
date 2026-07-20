import { useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { toast } from 'sonner'
import {
  ArrowsClockwise,
  Bell,
  CalendarBlank,
  Clock,
  LinkSimple,
  MapPin,
  Prohibit,
  SpeakerHigh,
  Tag,
  TextAlignLeft,
  TextT
} from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { BusyLabel } from '@renderer/components/common/busy-label'
import { ChannelKindIcon } from '@renderer/components/chat/channel-kind-icon'
import { DateTimePicker } from '@renderer/components/common/date-time-picker'
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
import { DescriptionEditor } from '@renderer/components/common/description-editor'
import { errorMessage } from '@renderer/lib/convex-error'
import {
  detectTimeZone,
  formatTimeInZone,
  partsInZone,
  sameClock,
  zoneLabel,
  zonedTimeToUtc
} from '@renderer/lib/timezone'
import { cn } from '@renderer/lib/utils'
import type { CalendarEvent } from '@renderer/lib/calendar-grid'
import { EVENT_KINDS, KIND_META, type EventKind } from '@renderer/components/events/event-kind'

/** Where a meeting happens. `none` clears both; the two are mutually exclusive — a
 *  meeting has one place. */
type Where = 'none' | 'voice' | 'link'

type Repeat = 'none' | 'daily' | 'weekly' | 'monthly'

const REPEAT_LABELS: Record<Repeat, string> = {
  none: 'Does not repeat',
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month'
}

/** Reminder offsets, in minutes before the start. `0` = "no reminder" — and, like
 *  every sentinel in this app, it shows a human label, never the raw `0`. */
const REMINDERS: { value: number; label: string }[] = [
  { value: 0, label: 'None' },
  { value: 5, label: '5 min' },
  { value: 10, label: '10 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 1440, label: '1 day' }
]

const WHERE_OPTIONS: { value: Where; label: string; icon: typeof Prohibit }[] = [
  { value: 'none', label: 'None', icon: Prohibit },
  { value: 'voice', label: 'Voice channel', icon: SpeakerHigh },
  { value: 'link', label: 'Link', icon: LinkSimple }
]

/**
 * Create or edit an event.
 *
 * **The form is wall-clock; the wire is UTC.** You pick "9:00 on the 18th" in the
 * `DateTimePicker`, and that is interpreted in the *workspace's* zone — the one
 * conversion a naive `new Date(value)` gets silently wrong for anyone not sitting in
 * the workspace's zone. The picker shows the zone it's typing in and echoes your own.
 *
 * **Where** an event meets is one of two things (never both): a **voice channel** in
 * this workspace (you jump into the call from the event) or an **external link**
 * (Zoom/Meet/an address). A plain **location** note is separate and optional.
 */
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
  const [start, setStart] = useState<Date | undefined>(new Date(base))
  const [end, setEnd] = useState<Date | undefined>(new Date(event?.endAt ?? base + 60 * 60 * 1000))
  const [where, setWhere] = useState<Where>(
    event?.channelId ? 'voice' : event?.url ? 'link' : 'none'
  )
  const [channelId, setChannelId] = useState<string>(event?.channelId ?? '')
  const [url, setUrl] = useState(event?.url ?? '')
  const [kind, setKind] = useState<EventKind>(event?.kind ?? 'meeting')
  const [repeat, setRepeat] = useState<Repeat>(
    (event?.repeat as Repeat | undefined) && event?.repeat !== 'none'
      ? (event?.repeat as Repeat)
      : 'none'
  )
  const [repeatUntil, setRepeatUntil] = useState<Date | undefined>(
    event?.repeatUntil ? new Date(event.repeatUntil) : undefined
  )
  const [reminder, setReminder] = useState<number>(event?.reminderMinutes ?? 10)
  const [busy, setBusy] = useState(false)

  const { startAt, endAt } = toInstants(start, end, allDay, zone)
  const valid =
    title.trim().length > 0 &&
    startAt !== null &&
    endAt !== null &&
    endAt >= startAt &&
    (where !== 'voice' || channelId !== '') &&
    (where !== 'link' || url.trim().length > 0)

  const viewer = detectTimeZone()
  const showsYourTime = !allDay && startAt !== null && !sameClock(zone, viewer, startAt)

  /** value → label for the voice-channel select. Only voice channels — that's where
   *  a meeting can actually happen. The id stays the value; only the name is rendered
   *  (the "never expose internal ids" rule), each with the voice channel icon (never a
   *  `#`, which reads as a text channel). */
  const voiceItems: Record<string, string> = useMemo(() => {
    const map: Record<string, string> = {}
    for (const channel of channels ?? []) {
      if (channel.kind === 'voice') map[channel._id] = channel.name
    }
    return map
  }, [channels])
  const hasVoiceChannels = Object.keys(voiceItems).length > 0

  const submit = async (formEvent: React.FormEvent): Promise<void> => {
    formEvent.preventDefault()
    if (!valid || busy || startAt === null || endAt === null) return
    setBusy(true)
    try {
      const voiceId = where === 'voice' ? (channelId as Id<'channels'>) : undefined
      const linkUrl = where === 'link' ? url.trim() : undefined
      const shared = {
        title: title.trim(),
        description: description.trim() || undefined,
        startAt,
        endAt,
        allDay,
        timezone: zone
      }
      const repeatUntilMs = repeat === 'none' ? undefined : repeatUntil?.getTime()
      if (event) {
        // Whole-state edit: `null` clears a field the user emptied/switched away from.
        await update({
          eventId: event._id,
          ...shared,
          location: location.trim() || null,
          channelId: voiceId ?? null,
          url: linkUrl ?? null,
          kind,
          repeat,
          repeatUntil: repeatUntilMs ?? null,
          reminderMinutes: reminder || null
        })
      } else {
        await create({
          workspaceId,
          ...shared,
          location: location.trim() || undefined,
          channelId: voiceId,
          url: linkUrl,
          kind,
          repeat,
          repeatUntil: repeatUntilMs,
          reminderMinutes: reminder || undefined
        })
      }
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
          className="no-scrollbar grid min-h-0 flex-1 gap-3.5 overflow-y-auto py-1"
        >
          <Field icon={TextT} label="Title" htmlFor="event-title">
            <Input
              id="event-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sprint planning"
              maxLength={120}
            />
          </Field>

          <Field icon={Tag} label="Type" htmlFor={undefined}>
            <div className="flex flex-wrap gap-1.5">
              {EVENT_KINDS.map((k) => {
                const active = kind === k
                const meta = KIND_META[k]
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className={cn(
                      'flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                      active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-transparent bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
                    )}
                  >
                    <span className={cn('size-2 rounded-full', meta.dot)} />
                    {meta.label}
                  </button>
                )
              })}
            </div>
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field icon={CalendarBlank} label="Starts" htmlFor="event-start">
              <DateTimePicker
                id="event-start"
                value={start}
                onChange={setStart}
                dateOnly={allDay}
                timeZone={zone}
                localTimeHint={false}
              />
            </Field>
            <Field icon={Clock} label="Ends" htmlFor="event-end">
              <DateTimePicker
                id="event-end"
                value={end}
                onChange={setEnd}
                dateOnly={allDay}
                timeZone={zone}
                localTimeHint={false}
              />
            </Field>
          </div>

          <label className="flex w-fit items-center gap-2 text-sm">
            <Checkbox checked={allDay} onCheckedChange={(next) => setAllDay(next === true)} />
            All day
          </label>

          {/* What you typed, in your own clock — so nobody schedules a 9am standup
              that turns out to be 4am for them. Only when the zones differ. */}
          {showsYourTime && startAt !== null && endAt !== null ? (
            <p className="-mt-1 text-xs text-muted-foreground">
              That&apos;s {formatTimeInZone(startAt, viewer)} – {formatTimeInZone(endAt, viewer)}{' '}
              your time.
            </p>
          ) : null}
          {endAt !== null && startAt !== null && endAt < startAt ? (
            <p className="-mt-1 text-xs text-destructive">The event ends before it starts.</p>
          ) : null}

          <Field icon={MapPin} label="Where" htmlFor={undefined}>
            <div className="grid gap-2">
              <div className="flex gap-1 rounded-lg bg-muted p-1">
                {WHERE_OPTIONS.map((option) => {
                  const active = where === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setWhere(option.value)}
                      className={cn(
                        'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                        active
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <option.icon className="size-3.5" weight={active ? 'fill' : 'regular'} />
                      {option.label}
                    </button>
                  )
                })}
              </div>

              {where === 'voice' ? (
                hasVoiceChannels ? (
                  <Select
                    items={voiceItems}
                    value={channelId || undefined}
                    onValueChange={(value) => setChannelId(value ?? '')}
                  >
                    <SelectTrigger>
                      <ChannelKindIcon kind="voice" className="size-4 text-muted-foreground" />
                      <SelectValue placeholder="Pick a voice channel" />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(voiceItems).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          <span className="flex items-center gap-1.5">
                            <ChannelKindIcon
                              kind="voice"
                              className="size-4 text-muted-foreground"
                            />
                            {label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                    This workspace has no voice channels yet. Create one, or use a link.
                  </p>
                )
              ) : null}

              {where === 'link' ? (
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="zoom.us/j/… or meet.google.com/…"
                  inputMode="url"
                  maxLength={500}
                />
              ) : null}
            </div>
          </Field>

          <Field icon={MapPin} label="Location" htmlFor="event-location" optional>
            <Input
              id="event-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Room 4B, or an address"
              maxLength={120}
            />
          </Field>

          <Field icon={Bell} label="Reminder" htmlFor={undefined}>
            <div className="flex flex-wrap gap-1.5">
              {REMINDERS.map((option) => {
                const active = reminder === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setReminder(option.value)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                      active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-transparent bg-muted text-muted-foreground hover:bg-accent hover:text-foreground'
                    )}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Everyone attending sees a “starting soon” banner in the app from then on.
            </p>
          </Field>

          <Field icon={ArrowsClockwise} label="Repeats" htmlFor={undefined}>
            <div className="grid gap-2">
              <Select
                items={REPEAT_LABELS}
                value={repeat}
                onValueChange={(value) => setRepeat((value as Repeat | undefined) ?? 'none')}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(REPEAT_LABELS) as Repeat[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {REPEAT_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {repeat !== 'none' ? (
                <div className="grid gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    Ends on — leave empty to repeat forever
                  </span>
                  <DateTimePicker
                    value={repeatUntil}
                    onChange={setRepeatUntil}
                    dateOnly
                    timeZone={zone}
                    localTimeHint={false}
                    placeholder="Repeats forever"
                  />
                </div>
              ) : null}
            </div>
          </Field>

          <Field icon={TextAlignLeft} label="Description" optional>
            {/* The app's ONE rich description editor (same as kanban tasks) — Markdown with
                `/` commands, `@` mentions and `#` channels. */}
            <DescriptionEditor
              initialMarkdown={description}
              onChange={setDescription}
              placeholder="What's this about?"
            />
          </Field>
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

/** A labelled form field with a leading themed icon — one consistent shape for every
 *  row, so nothing renders a stray black glyph. */
function Field({
  icon: Icon,
  label,
  htmlFor,
  optional,
  children
}: {
  icon: typeof Prohibit
  label: string
  htmlFor?: string
  optional?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor} className="flex items-center gap-1.5">
        <Icon className="size-3.5 text-muted-foreground" weight="duotone" />
        {label}
        {optional ? (
          <span className="text-xs font-normal text-muted-foreground">Optional</span>
        ) : null}
      </Label>
      {children}
    </div>
  )
}

/** start/end `Date`s → the UTC instants to store. All-day names a *date*: start is
 *  midnight, end is 23:59 of the end day, both in the workspace zone (so it can't
 *  slide a day when read elsewhere). */
function toInstants(
  start: Date | undefined,
  end: Date | undefined,
  allDay: boolean,
  zone: string
): { startAt: number | null; endAt: number | null } {
  if (!start || !end) return { startAt: null, endAt: null }
  if (!allDay) return { startAt: start.getTime(), endAt: end.getTime() }
  const s = partsInZone(start.getTime(), zone)
  const e = partsInZone(end.getTime(), zone)
  return {
    startAt: zonedTimeToUtc({ ...s, hour: 0, minute: 0 }, zone),
    endAt: zonedTimeToUtc({ ...e, hour: 23, minute: 59 }, zone)
  }
}

/** A sensible default for a new event: the next full hour. */
function nextHour(): number {
  const now = new Date()
  now.setMinutes(0, 0, 0)
  return now.getTime() + 60 * 60 * 1000
}
