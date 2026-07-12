import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { FileText, Hash, Kanban, SpeakerHigh } from '@phosphor-icons/react'
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

type Kind = 'chat' | 'voice' | 'page' | 'kanban'
const KINDS: { value: Kind; label: string; Icon: typeof Hash }[] = [
  { value: 'chat', label: 'Text', Icon: Hash },
  { value: 'voice', label: 'Voice', Icon: SpeakerHigh },
  { value: 'page', label: 'Page', Icon: FileText },
  { value: 'kanban', label: 'Board', Icon: Kanban }
]

/** Create a channel (optionally inside a group), then jump into it. */
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
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Kind>('chat')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const create = useMutation(api.channels.create)
  const navigate = useNavigate()

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const channelId = await create({ workspaceId, groupId, name: name.trim(), kind })
      onOpenChange(false)
      setName('')
      setKind('chat')
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a channel</DialogTitle>
          <DialogDescription>Channels are where your team talks about a topic.</DialogDescription>
        </DialogHeader>
        <form id="create-channel-form" onSubmit={submit} className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label>Channel type</Label>
            <div className="grid grid-cols-4 gap-2">
              {KINDS.map(({ value, label, Icon }) => (
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
              ))}
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
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-channel-form" disabled={busy || !name.trim()}>
            <BusyLabel busy={busy} busyText="Creating…" idle="Create channel" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
