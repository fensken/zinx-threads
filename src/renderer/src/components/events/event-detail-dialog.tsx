import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { toast } from 'sonner'
import {
  ArrowSquareOut,
  ArrowsClockwise,
  LinkSimple,
  MapPin,
  PencilSimple,
  Trash,
  User
} from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { Avatar, FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import { ConfirmDialog } from '@renderer/components/common/confirm-dialog'
import { LoadingBlock } from '@renderer/components/common/loading-block'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import { ChannelKindIcon } from '@renderer/components/chat/channel-kind-icon'
import { KIND_META, type EventKind } from '@renderer/components/events/event-kind'
import { EventTime } from '@renderer/components/events/event-time'
import type { CalendarEvent } from '@renderer/lib/calendar-grid'
import { errorMessage } from '@renderer/lib/convex-error'
import { initialsOf } from '@renderer/lib/initials'
import { platform } from '@renderer/lib/platform'
import { formatDateInZone } from '@renderer/lib/timezone'
import { cn } from '@renderer/lib/utils'

type Rsvp = 'going' | 'maybe' | 'declined'

const RSVPS: { value: Rsvp; label: string }[] = [
  { value: 'going', label: 'Going' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'declined', label: "Can't go" }
]

/** One event, in full: when (in both zones), where, who's coming, and your RSVP.
 *  Only the **organiser** can edit or delete — everyone else can only answer. */
export function EventDetailDialog({
  eventId,
  workspaceSlug,
  open,
  onOpenChange,
  onEdit
}: {
  eventId: Id<'events'> | null
  /** The workspace slug — needed to route "Join voice" to the channel. */
  workspaceSlug: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Edit — receives the **series** event (`events.get` is un-expanded), so editing a
   *  recurring event doesn't re-anchor the whole series to the clicked occurrence's date. */
  onEdit: (event: CalendarEvent) => void
}): React.JSX.Element {
  const detail = useQuery(api.events.get, eventId && open ? { eventId } : 'skip')
  const rsvp = useMutation(api.events.rsvp)
  const remove = useMutation(api.events.remove)
  const navigate = useNavigate()
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-lg">
          {detail === undefined ? (
            <div className="flex min-h-60 flex-col">
              <LoadingBlock />
            </div>
          ) : detail === null ? (
            <div className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
              This event is no longer available.
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="pr-8">{detail.event.title}</DialogTitle>
                {/* Not inside `DialogDescription`: it renders a <p>, and `EventTime`
                    is a two-line block — a <div> inside a <p> is invalid HTML. */}
                <EventTime
                  startAt={detail.event.startAt}
                  endAt={detail.event.endAt}
                  allDay={detail.event.allDay}
                  timezone={detail.event.timezone}
                />
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <KindBadge kind={detail.event.kind} />
                  {detail.event.repeat !== 'none' ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <ArrowsClockwise className="size-3.5" weight="duotone" />
                      {repeatLabel(
                        detail.event.repeat,
                        detail.event.repeatUntil,
                        detail.event.timezone
                      )}
                    </span>
                  ) : null}
                </div>
              </DialogHeader>

              <div className="no-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto">
                {/* Where the meeting is — a voice channel to jump into, or an external
                    link to open. Rendered as an action, not just a line of text. */}
                {detail.event.channelName ? (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChange(false)
                      void navigate({
                        to: '/w/$workspaceId/$channelSlug',
                        params: {
                          workspaceId: workspaceSlug,
                          channelSlug: detail.event.channelName as string
                        }
                      })
                    }}
                    className="flex w-full items-center gap-2 rounded-lg border bg-primary/5 px-3 py-2 text-left text-sm transition-colors hover:bg-primary/10"
                  >
                    <ChannelKindIcon
                      kind={detail.event.channelKind ?? 'voice'}
                      className="size-4 shrink-0 text-primary"
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {detail.event.channelName}
                    </span>
                    <span className="shrink-0 text-xs font-medium text-primary">Join voice</span>
                  </button>
                ) : detail.event.url ? (
                  <button
                    type="button"
                    onClick={() => void platform.openExternal(detail.event.url as string)}
                    className="flex w-full items-center gap-2 rounded-lg border bg-primary/5 px-3 py-2 text-left text-sm transition-colors hover:bg-primary/10"
                  >
                    <LinkSimple className="size-4 shrink-0 text-primary" weight="duotone" />
                    <span className="min-w-0 flex-1 truncate">{prettyUrl(detail.event.url)}</span>
                    <ArrowSquareOut className="size-4 shrink-0 text-primary" weight="duotone" />
                  </button>
                ) : null}

                <div className="space-y-1.5 text-xs text-muted-foreground">
                  {detail.event.location ? (
                    <p className="flex items-center gap-2">
                      <MapPin className="size-3.5 shrink-0" weight="duotone" />
                      <span className="truncate">{detail.event.location}</span>
                    </p>
                  ) : null}
                  <p className="flex items-center gap-2">
                    <User className="size-3.5 shrink-0" weight="duotone" />
                    <span className="truncate">Organised by {detail.event.creatorName}</span>
                  </p>
                </div>

                {detail.event.description ? (
                  <p className="text-sm whitespace-pre-wrap text-foreground">
                    {detail.event.description}
                  </p>
                ) : null}

                <div className="space-y-2">
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Going · {detail.event.going}
                    {detail.event.maybe > 0 ? ` · Maybe ${detail.event.maybe}` : ''}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.attendees
                      .filter((person) => person.status !== 'declined')
                      .map((person) => (
                        <span
                          key={person.userId}
                          title={`${person.name} — ${person.status}`}
                          className={cn(
                            'flex items-center gap-1.5 rounded-full bg-muted py-0.5 pr-2 pl-0.5 text-xs',
                            person.status === 'maybe' && 'opacity-60'
                          )}
                        >
                          <Avatar
                            initials={initialsOf(person.name)}
                            color={person.color ?? FALLBACK_AVATAR_COLOR}
                            image={person.avatarUrl}
                            className="size-5 text-[9px]"
                          />
                          {person.name}
                        </span>
                      ))}
                    {detail.attendees.filter((person) => person.status !== 'declined').length ===
                    0 ? (
                      <span className="text-xs text-muted-foreground">Nobody yet.</span>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* RSVP is everyone's; edit/delete is the organiser's alone. */}
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                {RSVPS.map((option) => (
                  <Button
                    key={option.value}
                    size="sm"
                    variant={detail.event.myStatus === option.value ? 'default' : 'outline'}
                    onClick={() =>
                      void rsvp({ eventId: detail.event._id, status: option.value }).catch((err) =>
                        toast.error(errorMessage(err, 'Could not save your answer'))
                      )
                    }
                  >
                    {option.label}
                  </Button>
                ))}

                {detail.canManage ? (
                  <span className="ml-auto flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => onEdit(detail.event)}>
                      <PencilSimple className="size-4" />
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash className="size-4" />
                      Delete
                    </Button>
                  </span>
                ) : null}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ConfirmDialog lives outside the main Dialog so it isn't unmounted with it. */}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this event?"
        description="It disappears from everyone's calendar, along with their RSVPs. This can't be undone."
        confirmLabel="Delete event"
        onConfirm={async () => {
          if (!eventId) return
          await remove({ eventId })
          onOpenChange(false)
        }}
      />
    </>
  )
}

/** A pill badge: coloured dot + icon + label — the event's type. */
function KindBadge({ kind }: { kind: EventKind }): React.JSX.Element {
  const meta = KIND_META[kind]
  const Glyph = meta.icon
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        meta.chip
      )}
    >
      <Glyph className="size-3.5" weight="fill" />
      {meta.label}
    </span>
  )
}

/** "Repeats every week" / "Repeats every day until Jul 30". */
function repeatLabel(repeat: string, repeatUntil: number | undefined, zone: string): string {
  const unit = repeat === 'daily' ? 'day' : repeat === 'weekly' ? 'week' : 'month'
  const base = `Repeats every ${unit}`
  return repeatUntil ? `${base} until ${formatDateInZone(repeatUntil, zone, true)}` : base
}

/** `https://zoom.us/j/123?x=y` → `zoom.us/j/123` — the scheme and query are noise. */
function prettyUrl(raw: string): string {
  try {
    const parsed = new URL(raw)
    return `${parsed.host}${parsed.pathname}`.replace(/\/$/, '')
  } catch {
    return raw
  }
}
