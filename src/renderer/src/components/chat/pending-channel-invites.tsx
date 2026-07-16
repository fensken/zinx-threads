import { useMemo, useState } from 'react'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import type { FunctionReturnType } from 'convex/server'
import { toast } from 'sonner'
import { Check, LinkSimple, MagnifyingGlass, X } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { errorMessage } from '@renderer/lib/convex-error'
import { cn } from '@renderer/lib/utils'
import { Spinner } from '@renderer/components/ui/spinner'
import { Input } from '@renderer/components/ui/input'
import { WorkspaceGlyph } from '@renderer/components/workspace/workspace-glyph'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'

type ChannelInvite = FunctionReturnType<typeof api.sharedChannels.listPendingForMe>[number]

/** Show up to this many invites inline in the sidebar; beyond it, collapse to a
 *  "Review all" button that opens the filterable dialog (so a burst of invites can't
 *  bury the channel list). */
const INLINE_LIMIT = 3
/** Show the dialog's filter box once there are more than this many invites. */
const FILTER_THRESHOLD = 5

interface InviteActions {
  busy: Id<'channelShares'> | null
  run: (shareId: Id<'channelShares'>, action: 'accept' | 'decline') => Promise<void>
}

function useInviteActions(): InviteActions {
  const accept = useMutation(api.sharedChannels.accept)
  const decline = useMutation(api.sharedChannels.decline)
  const [busy, setBusy] = useState<Id<'channelShares'> | null>(null)

  const run = async (shareId: Id<'channelShares'>, action: 'accept' | 'decline'): Promise<void> => {
    setBusy(shareId)
    try {
      if (action === 'accept') {
        const result = await accept({ shareId })
        toast.success(`Joined #${result.channelName || 'the shared channel'}.`)
      } else {
        await decline({ shareId })
      }
    } catch (err) {
      toast.error(errorMessage(err, 'Something went wrong'))
    } finally {
      setBusy(null)
    }
  }

  return { busy, run }
}

/** One invite, rendered for either the sidebar banner (`compact`) or the dialog. */
function InviteRow({
  invite,
  busy,
  run,
  compact
}: {
  invite: ChannelInvite
  busy: Id<'channelShares'> | null
  run: InviteActions['run']
  compact?: boolean
}): React.JSX.Element {
  const working = busy === invite._id
  return (
    <li
      className={cn(
        'rounded-md',
        compact ? 'bg-sidebar px-2 py-1.5 text-xs' : 'border bg-card p-3 text-sm'
      )}
    >
      <div className="flex items-start gap-2">
        <WorkspaceGlyph
          name={invite.ownerWorkspaceName}
          className={cn(
            'shrink-0 rounded bg-muted text-sidebar-foreground',
            compact ? 'size-5 text-[9px]' : 'size-9 text-xs'
          )}
        />
        <p className="min-w-0 flex-1 leading-tight">
          <span className="font-medium text-sidebar-foreground">{invite.ownerWorkspaceName}</span>{' '}
          invited{' '}
          <span className="font-medium text-sidebar-foreground">{invite.guestWorkspaceName}</span>{' '}
          to <span className="font-medium text-sidebar-foreground">#{invite.channelName}</span>.
        </p>
      </div>
      <div className={cn('mt-1.5 flex items-center gap-1.5', !compact && 'justify-end')}>
        <button
          type="button"
          disabled={working}
          onClick={() => void run(invite._id, 'accept')}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {working ? <Spinner className="size-3" /> : <Check className="size-3" weight="bold" />}
          Accept
        </button>
        <button
          type="button"
          disabled={working}
          onClick={() => void run(invite._id, 'decline')}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground disabled:opacity-60"
        >
          <X className="size-3" weight="bold" />
          Decline
        </button>
      </div>
    </li>
  )
}

/** All pending channel-share invites, in a scrollable, filterable modal — the
 *  "Review all" target when there are too many to show inline. */
function ChannelInvitesDialog({
  invites,
  open,
  onOpenChange
}: {
  invites: ChannelInvite[]
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const { busy, run } = useInviteActions()
  const [filter, setFilter] = useState('')

  const term = filter.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!term) return invites
    return invites.filter(
      (invite) =>
        invite.ownerWorkspaceName.toLowerCase().includes(term) ||
        invite.guestWorkspaceName.toLowerCase().includes(term) ||
        invite.channelName.toLowerCase().includes(term)
    )
  }, [invites, term])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Channel invitations</DialogTitle>
          <DialogDescription>
            Other workspaces invited you to shared channels. Accept to join — the host workspace
            still owns and moderates the channel.
          </DialogDescription>
        </DialogHeader>

        {invites.length > FILTER_THRESHOLD ? (
          <div className="relative">
            <MagnifyingGlass className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter by workspace or channel"
              className="pl-8"
            />
          </div>
        ) : null}

        <ul className="grid max-h-[60dvh] min-h-40 content-start gap-1.5 overflow-y-auto">
          {filtered.length > 0 ? (
            filtered.map((invite) => (
              <InviteRow key={invite._id} invite={invite} busy={busy} run={run} />
            ))
          ) : (
            <li className="flex min-h-40 items-center justify-center text-sm text-muted-foreground">
              No invitations match “{filter}”.
            </li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}

/** In-app surface for **channel-share invites** addressed to a workspace you own —
 *  another workspace invited yours to a shared channel; you accept or decline. Shown
 *  in the sidebar (below the quick nav) only when there's at least one pending. A few
 *  show inline for one-click accept; a burst collapses to a filterable dialog. */
export function PendingChannelInvites({
  workspaceId
}: {
  /** Scope the banner to the workspace the user is CURRENTLY viewing (the guest /
   *  destination). So someone who owns BOTH the inviting and invited workspaces sees
   *  the invite only while in the destination workspace — not everywhere they own. */
  workspaceId?: Id<'workspaces'>
}): React.JSX.Element | null {
  const all = useQuery(api.sharedChannels.listPendingForMe, {})
  const { busy, run } = useInviteActions()
  const [dialogOpen, setDialogOpen] = useState(false)

  const invites = useMemo(
    () => (all ?? []).filter((invite) => !workspaceId || invite.guestWorkspaceId === workspaceId),
    [all, workspaceId]
  )

  if (!all || invites.length === 0) return null

  const count = invites.length
  const collapsed = count > INLINE_LIMIT

  return (
    <div className="mx-2 mb-1 rounded-lg border border-primary/30 bg-primary/5 p-2">
      <div className="mb-1 flex items-center justify-between gap-1.5 px-1">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
          <LinkSimple className="size-3.5" weight="bold" />
          Channel invitations
        </span>
        <span className="rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground">
          {count}
        </span>
      </div>

      {collapsed ? (
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="w-full rounded-md bg-sidebar px-2 py-1.5 text-left text-xs transition-colors hover:bg-sidebar-accent"
        >
          <span className="text-sidebar-foreground">
            You have <span className="font-semibold">{count}</span> channel invitations.
          </span>
          <span className="mt-0.5 block font-medium text-primary">Review all →</span>
        </button>
      ) : (
        <ul className="grid gap-1">
          {invites.map((invite) => (
            <InviteRow key={invite._id} invite={invite} busy={busy} run={run} compact />
          ))}
        </ul>
      )}

      <ChannelInvitesDialog invites={invites} open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  )
}
