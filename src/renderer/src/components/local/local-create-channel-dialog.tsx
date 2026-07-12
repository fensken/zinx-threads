import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { FileText, Kanban } from '@phosphor-icons/react'
import { useLocalStore, type LocalChannelKind } from '@renderer/store/local-store'
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
import { cn } from '@renderer/lib/utils'

const KINDS: { kind: LocalChannelKind; label: string; hint: string; Icon: typeof FileText }[] = [
  { kind: 'page', label: 'Page', hint: 'A Notion-style doc', Icon: FileText },
  { kind: 'kanban', label: 'Board', hint: 'A kanban board', Icon: Kanban }
]

/** Create an offline page or board — the offline counterpart of the live
 *  `CreateChannelDialog`, restricted to the two kinds that work without a server. */
export function LocalCreateChannelDialog({
  groupId,
  open,
  onOpenChange
}: {
  /** Create it inside this group, or ungrouped when absent. */
  groupId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const createChannel = useLocalStore((state) => state.createChannel)
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<LocalChannelKind>('page')

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    const id = createChannel(name, kind, groupId)
    onOpenChange(false)
    setName('')
    setKind('page')
    void navigate({ to: '/local/$channelId', params: { channelId: id } })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create</DialogTitle>
          <DialogDescription>Pages and boards work fully offline on this device.</DialogDescription>
        </DialogHeader>

        <form id="local-create-form" onSubmit={submit} className="grid gap-3 py-1">
          <div className="grid grid-cols-2 gap-2">
            {KINDS.map(({ kind: k, label, hint, Icon }) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-lg border-2 px-3 py-3 text-sm transition-colors',
                  kind === k
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground'
                )}
              >
                <Icon className="size-6" />
                <span className="font-medium">{label}</span>
                <span className="text-[11px]">{hint}</span>
              </button>
            ))}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="local-channel-name">Name</Label>
            <Input
              id="local-channel-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={kind === 'page' ? 'roadmap' : 'sprint board'}
            />
          </div>
        </form>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="local-create-form">
            Create {kind === 'page' ? 'page' : 'board'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
