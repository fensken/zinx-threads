import { useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'
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
import { messagePreview } from '@renderer/lib/message-preview'

/** Threads are named (the demo's are: "Launch feedback"), and Discord prompts for
 *  a name too. Default it to the root message's preview so the common case is
 *  just Enter. */
const MAX_NAME = 80

export interface ThreadSeed {
  messageId: Id<'messages'>
  body: string
}

export function CreateThreadDialog({
  seed,
  onOpenChange,
  onCreated
}: {
  /** The message to branch from; `null` closes the dialog. */
  seed: ThreadSeed | null
  onOpenChange: (open: boolean) => void
  onCreated: (threadId: Id<'threads'>) => void
}): React.JSX.Element {
  const createThread = useMutation(api.threads.create)
  const [name, setName] = useState('')
  const [seededFrom, setSeededFrom] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Seed the field from the message being branched — adjusted *during render*
  // (React's documented alternative to a syncing effect), so opening the dialog
  // never flashes an empty input. Clearing on close lets the same message be
  // re-seeded if you cancel and try again.
  if (seed && seed.messageId !== seededFrom) {
    setSeededFrom(seed.messageId)
    setName(messagePreview(seed.body).text.slice(0, MAX_NAME))
  } else if (!seed && seededFrom !== null) {
    setSeededFrom(null)
  }

  const submit = async (): Promise<void> => {
    if (!seed || !name.trim() || busy) return
    setBusy(true)
    try {
      const threadId = await createThread({ messageId: seed.messageId, name: name.trim() })
      onOpenChange(false)
      onCreated(threadId)
    } catch (error) {
      toast.error(errorMessage(error, 'Could not start the thread'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={seed !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start a thread</DialogTitle>
          <DialogDescription>
            Keep a side conversation out of the channel. The original message stays where it is.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="thread-name">Thread name</Label>
          <Input
            id="thread-name"
            autoFocus
            value={name}
            maxLength={MAX_NAME}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submit()
              }
            }}
            placeholder="What's this about?"
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!name.trim() || busy} onClick={() => void submit()}>
            <BusyLabel busy={busy} busyText="Starting…" idle="Start thread" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
