import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { toast } from 'sonner'
import { Check, MagnifyingGlass, X } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { Avatar, FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import { BusyLabel } from '@renderer/components/common/busy-label'
import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { LoadingBlock } from '@renderer/components/common/loading-block'
import { errorMessage } from '@renderer/lib/convex-error'

/** You plus this many others — mirrors `dms.MAX_DM_MEMBERS` on the server, which is
 *  the one that actually enforces it. */
const MAX_OTHERS = 8

/** Start (or reopen) a conversation. Picking people is the whole interaction: a DM
 *  has no name, no topic and no settings — Slack's composer works the same way.
 *
 *  Selecting more than one person makes it a **group** conversation. `dms.open` is
 *  find-or-create keyed on the participant set, so picking the same people twice
 *  lands back in the same conversation rather than making a second empty one. */
export function NewDmDialog({
  workspaceId,
  serverId,
  open,
  onOpenChange
}: {
  workspaceId: Id<'workspaces'>
  serverId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const navigate = useNavigate()
  const me = useQuery(api.users.me)
  const members = useQuery(api.members.listByWorkspace, open ? { workspaceId } : 'skip')
  const openDm = useMutation(api.dms.open)

  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Id<'users'>[]>([])
  const [busy, setBusy] = useState(false)

  // You're always in your own conversation — you're never in the list to pick.
  const candidates = useMemo(() => {
    const rows = (members ?? []).filter((entry) => entry.user._id !== me?._id)
    const term = query.trim().toLowerCase()
    if (!term) return rows
    return rows.filter(
      (entry) =>
        entry.user.name.toLowerCase().includes(term) ||
        entry.user.email.toLowerCase().includes(term)
    )
  }, [members, query, me?._id])

  const pickedRows = useMemo(
    () => (members ?? []).filter((entry) => picked.includes(entry.user._id)),
    [members, picked]
  )

  const toggle = (id: Id<'users'>): void => {
    setPicked((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : current.length >= MAX_OTHERS
          ? current
          : [...current, id]
    )
  }

  const reset = (): void => {
    setQuery('')
    setPicked([])
  }

  const submit = async (): Promise<void> => {
    if (picked.length === 0 || busy) return
    setBusy(true)
    try {
      const channelId = await openDm({ workspaceId, userIds: picked })
      onOpenChange(false)
      reset()
      await navigate({
        to: '/w/$workspaceId/d/$channelId',
        params: { workspaceId: serverId, channelId }
      })
    } catch (err) {
      toast.error(errorMessage(err, 'Could not open the conversation'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="flex max-h-[80dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>
            Pick one person, or several for a group conversation.
          </DialogDescription>
        </DialogHeader>

        {/* Chips for who's picked, then the search field — the same shape as the
            kanban assignee picker, so multi-select reads the same across the app. */}
        <div className="flex flex-col gap-2">
          {pickedRows.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {pickedRows.map((entry) => (
                <button
                  key={entry.user._id}
                  type="button"
                  onClick={() => toggle(entry.user._id)}
                  className="flex items-center gap-1 rounded-full bg-secondary py-0.5 pr-1 pl-1 text-xs text-secondary-foreground transition-colors hover:bg-secondary/70"
                >
                  <Avatar
                    initials={initials(entry.user.name)}
                    color={entry.user.color ?? FALLBACK_AVATAR_COLOR}
                    image={entry.user.avatarUrl}
                    className="size-4 text-[8px]"
                  />
                  {entry.user.name}
                  <X className="size-3 text-muted-foreground" />
                </button>
              ))}
            </div>
          ) : null}

          <div className="flex h-9 items-center gap-2 rounded-md border px-2.5">
            <MagnifyingGlass className="size-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or email"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
          <div className="flex min-h-60 flex-col">
            {members === undefined ? (
              <LoadingBlock />
            ) : candidates.length === 0 ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 text-center">
                <p className="text-sm font-medium">
                  {query.trim() ? 'Nobody matches that' : 'Nobody else is here yet'}
                </p>
                <p className="max-w-64 text-xs text-muted-foreground">
                  {query.trim()
                    ? 'Try a different name or email.'
                    : 'Invite teammates to the workspace and you can message them.'}
                </p>
              </div>
            ) : (
              <ul className="grid gap-0.5">
                {candidates.map((entry) => {
                  const isPicked = picked.includes(entry.user._id)
                  const full = !isPicked && picked.length >= MAX_OTHERS
                  return (
                    <li key={entry.user._id}>
                      <button
                        type="button"
                        disabled={full}
                        onClick={() => toggle(entry.user._id)}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Avatar
                          initials={initials(entry.user.name)}
                          color={entry.user.color ?? FALLBACK_AVATAR_COLOR}
                          image={entry.user.avatarUrl}
                          className="size-7 text-[10px]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {entry.user.name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {entry.user.statusText || entry.user.email}
                          </span>
                        </span>
                        {isPicked ? <Check className="size-4 text-primary" weight="bold" /> : null}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={picked.length === 0 || busy} onClick={() => void submit()}>
            <BusyLabel
              busy={busy}
              idle={picked.length > 1 ? 'Start group message' : 'Start message'}
            />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
