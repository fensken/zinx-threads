import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import {
  Check,
  FileText,
  Hash,
  Kanban,
  LockSimple,
  PenNib,
  SpeakerHigh
} from '@phosphor-icons/react'
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
import { cn } from '@renderer/lib/utils'
import { errorMessage } from '@renderer/lib/convex-error'

export type ChannelDialogKind = 'chat' | 'voice' | 'page' | 'kanban' | 'whiteboard'

const KIND_META: Record<ChannelDialogKind, { label: string; Icon: typeof Hash }> = {
  chat: { label: 'Text', Icon: Hash },
  voice: { label: 'Voice', Icon: SpeakerHigh },
  page: { label: 'Page', Icon: FileText },
  kanban: { label: 'Board', Icon: Kanban },
  whiteboard: { label: 'Whiteboard', Icon: PenNib }
}
const ALL_KINDS: ChannelDialogKind[] = ['chat', 'voice', 'page', 'kanban', 'whiteboard']

/**
 * The presentational Create-a-channel dialog — **the one component both the online and
 * local workspaces render**, so the UI is identical. Server-only bits are hidden by
 * props, not by a fork: `kinds` narrows the type grid (local drops `chat`/`voice`) and
 * `allowPrivate` hides the private toggle (visibility is a membership concept — no
 * server, no private). The caller owns creation via `onSubmit` + `busy`/`error`.
 */
export function CreateChannelDialogView({
  open,
  onOpenChange,
  kinds = ALL_KINDS,
  allowPrivate = true,
  busy = false,
  error = null,
  title = 'Create a channel',
  description = 'Channels are where your team talks about a topic.',
  submitLabel = 'Create channel',
  onSubmit
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  kinds?: ChannelDialogKind[]
  allowPrivate?: boolean
  busy?: boolean
  error?: string | null
  title?: string
  description?: string
  submitLabel?: string
  onSubmit: (values: { name: string; kind: ChannelDialogKind; isPrivate: boolean }) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ChannelDialogKind>(kinds[0])
  const [isPrivate, setPrivate] = useState(false)

  // Fresh fields each time it opens — render-time reset, not an effect.
  const [seenOpen, setSeenOpen] = useState(open)
  if (open !== seenOpen) {
    setSeenOpen(open)
    if (open) {
      setName('')
      setKind(kinds[0])
      setPrivate(false)
    }
  }

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    if (!name.trim() || busy) return
    onSubmit({ name: name.trim(), kind, isPrivate })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form id="create-channel-form" onSubmit={submit} className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label>Channel type</Label>
            <div className="grid grid-cols-4 gap-2">
              {kinds.map((value) => {
                const { label, Icon } = KIND_META[value]
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setKind(value)}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-lg border-2 py-2.5 text-xs font-medium transition-colors',
                      kind === value
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
                    )}
                  >
                    <Icon className="size-5" />
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="channel-name">Channel name</Label>
            <Input
              id="channel-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="marketing"
              maxLength={60}
            />
          </div>
          {/* Private is decided at creation because converting later exposes (or hides) the
              history that's already there — the one moment it costs nothing is now. */}
          {allowPrivate ? (
            <button
              type="button"
              onClick={() => setPrivate((current) => !current)}
              className={cn(
                'flex items-start gap-3 rounded-lg border-2 px-3 py-2.5 text-left transition-colors',
                isPrivate
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:border-muted-foreground/40 hover:bg-accent'
              )}
            >
              <LockSimple
                className={cn(
                  'mt-0.5 size-4 shrink-0',
                  isPrivate ? 'text-primary' : 'text-muted-foreground'
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">Make private</span>
                <span className="block text-xs text-muted-foreground">
                  Only people you add can see it — admins included.
                </span>
              </span>
              <span
                className={cn(
                  'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border',
                  isPrivate ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                )}
              >
                {isPrivate ? <Check weight="bold" className="size-3" /> : null}
              </span>
            </button>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-channel-form" disabled={busy || !name.trim()}>
            <BusyLabel busy={busy} busyText="Creating…" idle={submitLabel} />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Create a channel (optionally inside a group), then jump into it. The online wrapper
 *  around the shared view — wires the Convex mutation + navigation. */
export function CreateChannelDialog({
  workspaceId,
  workspaceSlug,
  groupId,
  open,
  onOpenChange
}: {
  workspaceId: Id<'workspaces'>
  workspaceSlug: string
  groupId?: Id<'channelGroups'>
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const create = useMutation(api.channels.create)
  const navigate = useNavigate()

  const onSubmit = async ({
    name,
    kind,
    isPrivate
  }: {
    name: string
    kind: ChannelDialogKind
    isPrivate: boolean
  }): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const channelId = await create({
        workspaceId,
        groupId,
        name,
        kind,
        ...(isPrivate ? { visibility: 'private' as const } : {})
      })
      onOpenChange(false)
      await navigate({
        to: '/w/$workspaceId/c/$channelId',
        params: { workspaceId: workspaceSlug, channelId }
      })
    } catch (err) {
      setError(errorMessage(err, 'Could not create channel'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <CreateChannelDialogView
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      error={error}
      onSubmit={(values) => void onSubmit(values)}
    />
  )
}
