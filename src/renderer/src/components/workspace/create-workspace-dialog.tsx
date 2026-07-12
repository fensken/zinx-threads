import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { Check, Warning } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
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
import { Spinner } from '@renderer/components/ui/spinner'
import { BusyLabel } from '@renderer/components/common/busy-label'
import { errorMessage } from '@renderer/lib/convex-error'
import { toSlug } from '@renderer/lib/slug'

/** Create-workspace dialog (used by the switcher + onboarding). Picks a **name** and a
 *  URL **address** (slug) — the address auto-fills from the name and is checked for
 *  availability as you type; taken/reserved addresses are flagged before you submit. */
export function CreateWorkspaceDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const create = useMutation(api.workspaces.create)
  const navigate = useNavigate()

  const availability = useQuery(api.workspaces.slugAvailable, slug.length >= 2 ? { slug } : 'skip')
  const canSubmit = name.trim().length >= 2 && availability?.available === true && !busy

  const onNameChange = (value: string): void => {
    setName(value)
    if (!slugTouched) setSlug(toSlug(value))
  }

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      const result = await create({ name: name.trim(), slug })
      onOpenChange(false)
      setName('')
      setSlug('')
      setSlugTouched(false)
      await navigate({ to: '/w/$workspaceId', params: { workspaceId: result.slug } })
    } catch (err) {
      setError(errorMessage(err, 'Could not create workspace'))
    } finally {
      setBusy(false)
    }
  }

  const status = (): React.JSX.Element | null => {
    if (slug.length < 2) return null
    if (availability === undefined) {
      return (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Spinner className="size-3" /> Checking…
        </p>
      )
    }
    if (availability.available) {
      return (
        <p className="flex items-center gap-1 text-xs text-emerald-500">
          <Check className="size-3.5" weight="bold" /> Available
        </p>
      )
    }
    const message =
      availability.reason === 'taken'
        ? 'That address is taken — try another.'
        : availability.reason === 'reserved'
          ? 'That address is reserved.'
          : 'Use lowercase letters, numbers, and hyphens.'
    return (
      <p className="flex items-center gap-1 text-xs text-destructive">
        <Warning className="size-3.5" weight="bold" /> {message}
      </p>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a workspace</DialogTitle>
          <DialogDescription>
            A workspace is where your team chats, plans, and shares.
          </DialogDescription>
        </DialogHeader>
        <form id="create-workspace-form" onSubmit={submit} className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ws-name">Workspace name</Label>
            <Input
              id="ws-name"
              autoFocus
              value={name}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Acme Inc."
              maxLength={60}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ws-slug">Address</Label>
            <div className="flex items-center rounded-md border bg-transparent focus-within:border-ring">
              <span className="pl-3 text-sm text-muted-foreground select-none">/w/</span>
              <Input
                id="ws-slug"
                value={slug}
                onChange={(event) => {
                  setSlugTouched(true)
                  setSlug(toSlug(event.target.value))
                }}
                placeholder="acme"
                maxLength={40}
                className="border-0 pl-1 focus-visible:ring-0"
              />
            </div>
            {status()}
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="create-workspace-form" disabled={!canSubmit}>
            <BusyLabel busy={busy} busyText="Creating…" idle="Create workspace" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
