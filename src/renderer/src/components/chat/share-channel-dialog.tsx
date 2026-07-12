import { useState } from 'react'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { toast } from 'sonner'
import { PlugsConnected, SignOut, Trash } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
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
import { Button } from '@renderer/components/ui/button'
import { BusyLabel } from '@renderer/components/common/busy-label'
import { errorMessage } from '@renderer/lib/convex-error'

/** The channel's cross-workspace connections (Slack Connect), role-aware:
 *  - **host owner/admin** (`canManage`): invite another workspace by address, and
 *    remove connected ones — this workspace is in charge.
 *  - **guest** (a member of a workspace the channel was shared INTO): a read-only
 *    list of who's connected, plus the option to leave. Guests can't invite or
 *    remove anyone else.
 *  One dialog, opened from the single connection pill in the header. */
export function ChannelConnectionsDialog({
  channelId,
  channelName,
  workspaceId,
  canManage,
  open,
  onOpenChange
}: {
  channelId: Id<'channels'>
  channelName: string
  /** The caller's (guest) workspace — needed to leave. */
  workspaceId?: Id<'workspaces'>
  canManage: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PlugsConnected className="size-5 text-primary" />
            {canManage ? `Share #${channelName}` : `#${channelName} connections`}
          </DialogTitle>
          <DialogDescription>
            {canManage
              ? 'Connect another workspace to this channel. Enter its workspace address (the slug in its URL); its owner accepts, then their members can read and post here.'
              : 'This channel is shared across workspaces. The host workspace is in charge — you can see who’s connected and leave anytime.'}
          </DialogDescription>
        </DialogHeader>

        {canManage ? (
          <OwnerConnections channelId={channelId} open={open} />
        ) : (
          <GuestConnections
            channelId={channelId}
            workspaceId={workspaceId}
            onLeft={() => onOpenChange(false)}
          />
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Host owner/admin view: invite + remove connected workspaces. */
function OwnerConnections({
  channelId,
  open
}: {
  channelId: Id<'channels'>
  open: boolean
}): React.JSX.Element {
  const invite = useMutation(api.sharedChannels.invite)
  const removeGuest = useMutation(api.sharedChannels.removeGuest)
  const guests = useQuery(api.sharedChannels.listForChannel, open ? { channelId } : 'skip')
  const [slug, setSlug] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    const target = slug.trim().toLowerCase()
    if (!target) return
    setBusy(true)
    try {
      const result = await invite({ channelId, guestSlug: target })
      setSlug('')
      toast.success(
        result.status === 'accepted'
          ? 'That workspace already has access.'
          : 'Invitation sent — the workspace owner needs to accept.'
      )
    } catch (err) {
      toast.error(errorMessage(err, 'Could not share the channel'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <form id="share-form" onSubmit={submit} className="grid gap-2 py-1">
        <Label htmlFor="share-slug">Workspace address</Label>
        <div className="flex items-center gap-2">
          <Input
            id="share-slug"
            autoFocus
            value={slug}
            onChange={(event) => setSlug(event.target.value)}
            placeholder="acme"
          />
          <Button type="submit" form="share-form" disabled={busy || !slug.trim()}>
            <BusyLabel busy={busy} busyText="Sharing…" idle="Share" />
          </Button>
        </div>
      </form>

      <div className="grid gap-1">
        <Label className="text-xs text-muted-foreground">Connected workspaces</Label>
        {guests === undefined ? (
          <p className="py-2 text-sm text-muted-foreground">Loading…</p>
        ) : guests.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            No other workspaces yet. This channel is private to yours.
          </p>
        ) : (
          <ul className="grid gap-1">
            {guests.map((guest) => (
              <li
                key={guest._id}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate">
                  <span className="font-medium">{guest.guestWorkspaceName}</span>
                  <span
                    className={
                      guest.status === 'accepted'
                        ? 'ml-2 text-xs text-emerald-500'
                        : 'ml-2 text-xs text-muted-foreground'
                    }
                  >
                    {guest.status === 'accepted' ? 'Connected' : 'Pending'}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${guest.guestWorkspaceName}`}
                  onClick={() =>
                    void removeGuest({
                      channelId,
                      guestWorkspaceId: guest.guestWorkspaceId
                    }).catch((err) => toast.error(errorMessage(err, 'Could not remove')))
                  }
                >
                  <Trash className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  )
}

/** Guest view: read-only list of connected workspaces + leave. A guest can't invite
 *  or remove anyone — only the host workspace manages the connection. */
function GuestConnections({
  channelId,
  workspaceId,
  onLeft
}: {
  channelId: Id<'channels'>
  workspaceId?: Id<'workspaces'>
  onLeft: () => void
}): React.JSX.Element {
  const conn = useQuery(api.sharedChannels.connection, { channelId })
  const leave = useMutation(api.sharedChannels.leave)
  const [busy, setBusy] = useState(false)

  const doLeave = async (): Promise<void> => {
    if (!workspaceId) return
    setBusy(true)
    try {
      await leave({ channelId, workspaceId })
      toast.success('Left the shared channel.')
      onLeft()
    } catch (err) {
      toast.error(errorMessage(err, 'Could not leave'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="grid gap-1">
        <Label className="text-xs text-muted-foreground">Connected workspaces</Label>
        {conn === undefined ? (
          <p className="py-2 text-sm text-muted-foreground">Loading…</p>
        ) : !conn?.isShared ? (
          <p className="py-2 text-sm text-muted-foreground">This channel isn’t connected.</p>
        ) : (
          <ul className="grid gap-1">
            {conn.workspaces.map((name, index) => (
              <li
                key={`${name}-${index}`}
                className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <PlugsConnected className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                {index === 0 ? <span className="text-xs text-muted-foreground">Host</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Only an actual guest can leave — a plain member of the HOST workspace can
          view the connections here but has no share to leave. */}
      {conn?.viaGuest ? (
        <Button
          type="button"
          variant="outline"
          className="gap-2 text-destructive hover:text-destructive"
          disabled={busy || !workspaceId}
          onClick={() => void doLeave()}
        >
          <SignOut className="size-4" />
          <BusyLabel busy={busy} busyText="Leaving…" idle="Leave channel" />
        </Button>
      ) : null}
    </>
  )
}
