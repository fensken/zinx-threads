import { useState } from 'react'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { toast } from 'sonner'
import { Hash, MapPin, PencilSimple, Trash, User } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { Avatar, FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import { ConfirmDialog } from '@renderer/components/common/confirm-dialog'
import { LoadingBlock } from '@renderer/components/common/loading-block'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import { EventTime } from '@renderer/components/events/event-time'
import { errorMessage } from '@renderer/lib/convex-error'
import { initialsOf } from '@renderer/lib/initials'
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
  open,
  onOpenChange,
  onEdit
}: {
  eventId: Id<'events'> | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: () => void
}): React.JSX.Element {
  const detail = useQuery(api.events.get, eventId && open ? { eventId } : 'skip')
  const rsvp = useMutation(api.events.rsvp)
  const remove = useMutation(api.events.remove)
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
              </DialogHeader>

              <div className="no-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto">
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  {detail.event.location ? (
                    <p className="flex items-center gap-2">
                      <MapPin className="size-3.5 shrink-0" />
                      <span className="truncate">{detail.event.location}</span>
                    </p>
                  ) : null}
                  {detail.event.channelName ? (
                    <p className="flex items-center gap-2">
                      <Hash className="size-3.5 shrink-0" />
                      <span className="truncate">{detail.event.channelName}</span>
                    </p>
                  ) : null}
                  <p className="flex items-center gap-2">
                    <User className="size-3.5 shrink-0" />
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
                    <Button size="sm" variant="ghost" onClick={onEdit}>
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
