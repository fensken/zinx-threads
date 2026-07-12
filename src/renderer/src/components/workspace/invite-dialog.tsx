import { useState } from 'react'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { toast } from 'sonner'
import { Check, Copy, Trash } from '@phosphor-icons/react'
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
import { Label } from '@renderer/components/ui/label'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Textarea } from '@renderer/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { BusyLabel } from '@renderer/components/common/busy-label'
import { errorMessage } from '@renderer/lib/convex-error'
import { workspaceInviteUrl } from '@renderer/lib/invite-links'
import { copyToClipboard } from '@renderer/lib/clipboard'

const EXPIRY_OPTIONS = [
  { value: 'never', label: 'Never' },
  { value: '1', label: '1 day' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' }
] as const

/** Create + manage **reusable invite links** (Discord-style) for a workspace. Anyone
 *  who opens a link joins; a link can be permanent or expiring, and open to anyone or
 *  restricted to a whitelist of emails. No email is sent — you copy the link and share
 *  it however you like. */
export function InviteDialog({
  workspaceId,
  workspaceName,
  open,
  onOpenChange
}: {
  workspaceId: Id<'workspaces'>
  workspaceName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const invite = useMutation(api.invitations.invite)
  const revoke = useMutation(api.invitations.revoke)
  const links = useQuery(api.invitations.listByWorkspace, open ? { workspaceId } : 'skip')

  const [expiry, setExpiry] = useState<string>('7')
  const [restrict, setRestrict] = useState(false)
  const [emails, setEmails] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      const expiresInDays = expiry === 'never' ? undefined : Number(expiry)
      const allowedEmails = restrict
        ? emails
            .split(/[\s,;]+/)
            .map((e) => e.trim())
            .filter(Boolean)
        : undefined
      if (restrict && (!allowedEmails || allowedEmails.length === 0)) {
        toast.error('Add at least one email, or turn off the restriction')
        return
      }
      await invite({ workspaceId, expiresInDays, allowedEmails })
      setEmails('')
    } catch (err) {
      toast.error(errorMessage(err, 'Could not create invite link'))
    } finally {
      setBusy(false)
    }
  }

  const copy = async (code: string): Promise<void> => {
    const ok = await copyToClipboard(workspaceInviteUrl(code))
    if (!ok) {
      toast.error('Could not copy the link — select and copy it manually')
      return
    }
    toast.success('Invite link copied')
    setCopied(code)
    setTimeout(() => setCopied((c) => (c === code ? null : c)), 1500)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite people</DialogTitle>
          <DialogDescription>
            Create an invite link for{' '}
            <span className="font-medium text-foreground">{workspaceName}</span> and share it.
            Anyone who opens it joins — no email needed.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-1">
          <div className="grid gap-1.5">
            <Label htmlFor="invite-expiry">Expire after</Label>
            <Select value={expiry} onValueChange={(value) => setExpiry(value ?? '7')}>
              <SelectTrigger id="invite-expiry" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPIRY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-sm select-none">
            <Checkbox
              checked={restrict}
              className="mt-0.5"
              onCheckedChange={(checked) => setRestrict(checked === true)}
            />
            <span className="leading-tight">
              Restrict to specific emails
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Only these people can join with the link. Leave off to allow anyone.
              </span>
            </span>
          </label>
          {restrict ? (
            <Textarea
              value={emails}
              onChange={(event) => setEmails(event.target.value)}
              placeholder="alice@acme.com, bob@acme.com"
              rows={3}
              className="text-sm"
            />
          ) : null}

          <Button onClick={() => void create()} disabled={busy} className="w-full">
            <BusyLabel busy={busy} busyText="Creating…" idle="Create invite link" />
          </Button>
        </div>

        {links && links.length > 0 ? (
          <div className="grid gap-1.5">
            <Label className="text-xs text-muted-foreground">Active links</Label>
            <ul className="grid max-h-56 gap-1.5 overflow-y-auto">
              {links.map((link) => (
                <li key={link._id} className="rounded-md border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate font-mono text-xs">
                      {workspaceInviteUrl(link.code)}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="size-7 shrink-0"
                      onClick={() => void copy(link.code)}
                      aria-label="Copy link"
                    >
                      {copied === link.code ? (
                        <Check className="size-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() =>
                        void revoke({ invitationId: link._id }).catch((err) =>
                          toast.error(errorMessage(err, 'Could not revoke'))
                        )
                      }
                      aria-label="Revoke link"
                    >
                      <Trash className="size-3.5" />
                    </Button>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {link.expired
                      ? 'Expired'
                      : link.expiresAt
                        ? `Expires ${new Date(link.expiresAt).toLocaleDateString()}`
                        : 'Never expires'}
                    {link.allowedEmails.length > 0
                      ? ` · ${link.allowedEmails.length} email${link.allowedEmails.length === 1 ? '' : 's'} allowed`
                      : ' · Anyone with the link'}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
