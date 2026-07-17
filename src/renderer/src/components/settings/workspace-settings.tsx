import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { useUploadFile } from '@convex-dev/r2/react'
import { toast } from 'sonner'
import { Check, Warning, X } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Doc, Id } from '@convex/_generated/dataModel'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/spinner'
import { BusyLabel } from '@renderer/components/common/busy-label'
import { TimezoneSelect } from '@renderer/components/common/timezone-select'
import { toSlug } from '@renderer/lib/slug'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { useUiStore } from '@renderer/store/ui-store'
import { ConfirmDialog } from '@renderer/components/common/confirm-dialog'
import { WorkspaceDeleteCard } from '@renderer/components/settings/workspace-delete-card'
import { Avatar, FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import { UploadableAvatar } from '@renderer/components/common/uploadable-avatar'
import { IconPickerDialog } from '@renderer/components/pickers/icon-picker-dialog'
import { WorkspaceGlyph } from '@renderer/components/workspace/workspace-glyph'
import { errorMessage } from '@renderer/lib/convex-error'
import { detectTimeZone, localTimeLabel } from '@renderer/lib/timezone'

// The four workspace-settings panels. They're hosted as sections of the unified
// Settings modal (`settings-dialog.tsx`); each resolves real Convex data.

export type Role = 'owner' | 'admin' | 'member' | 'guest'

/** The roles an owner/admin can assign, and what they're **called**. The key is the
 *  stored value; the value is the only thing a user ever sees. */
const ROLE_LABELS: Record<string, string> = { member: 'Member', admin: 'Admin' }

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Your per-workspace profile — the display name teammates see in *this* workspace
 *  (Discord-style nickname). Editable by every member. */
export function ProfileTab({
  workspaceId,
  initialDisplayName
}: {
  workspaceId: Id<'workspaces'>
  initialDisplayName: string
}): React.JSX.Element {
  const me = useQuery(api.users.me)
  const updateProfile = useMutation(api.members.updateMyProfile)
  const [displayName, setDisplayName] = useState(initialDisplayName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const accountName = me?.name || me?.email || 'You'
  const effective = displayName.trim() || accountName
  const dirty = displayName !== initialDisplayName

  // The profile photo is account-global (Slack model: per-workspace name, one
  // photo), so uploading here updates the account avatar shown everywhere.
  const uploadFile = useUploadFile(api.files)
  const setUploadedAvatar = useMutation(api.users.setUploadedAvatar)

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await updateProfile({ workspaceId, displayName })
      setSaved(true)
    } catch (err) {
      setError(errorMessage(err, 'Could not save'))
    } finally {
      setBusy(false)
    }
  }

  const uploadAvatar = async (file: File): Promise<void> => {
    try {
      const key = await uploadFile(file)
      await setUploadedAvatar({ key })
    } catch (err) {
      toast.error(errorMessage(err, 'Could not upload the image'))
    }
  }

  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-3">
        <UploadableAvatar size="size-14" onFile={uploadAvatar}>
          <Avatar
            initials={initialsOf(effective)}
            color={me?.color ?? FALLBACK_AVATAR_COLOR}
            image={me?.avatarUrl}
            className="size-full text-base"
          />
        </UploadableAvatar>
        <div className="leading-tight">
          <div className="font-semibold">{effective}</div>
          <div className="text-sm text-muted-foreground">{me?.email ?? ''}</div>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="ws-display-name">Display name in this workspace</Label>
        <Input
          id="ws-display-name"
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value)
            setSaved(false)
          }}
          placeholder={accountName}
          maxLength={60}
        />
        <p className="text-xs text-muted-foreground">
          Shown to teammates here instead of your account name ({accountName}). Leave blank to use
          your account name.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy || !dirty}>
          <BusyLabel busy={busy} busyText="Saving…" idle="Save" />
        </Button>
        {saved && !dirty ? <span className="text-sm text-muted-foreground">Saved.</span> : null}
      </div>
    </div>
  )
}

export function GeneralTab({
  workspace,
  canManage
}: {
  workspace: Doc<'workspaces'>
  canManage: boolean
}): React.JSX.Element {
  const update = useMutation(api.workspaces.update)
  const uploadFile = useUploadFile(api.files)
  const setLogo = useMutation(api.workspaces.setLogo)
  const removeLogo = useMutation(api.workspaces.removeLogo)
  const navigate = useNavigate()
  const [name, setName] = useState(workspace.name)
  const [slug, setSlug] = useState(workspace.slug)
  const [icon, setIcon] = useState(workspace.icon ?? '')
  // Workspaces created before zones existed have none — seed the field from the
  // viewer's own so it shows a real value rather than a blank that saves as blank.
  const [timezone, setTimezone] = useState(workspace.timezone ?? detectTimeZone())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const slugChanged = slug !== workspace.slug
  const availability = useQuery(
    api.workspaces.slugAvailable,
    slugChanged && slug.length >= 2 ? { slug } : 'skip'
  )
  const slugOk = !slugChanged || availability?.available === true
  const dirty =
    name !== workspace.name ||
    icon !== (workspace.icon ?? '') ||
    slugChanged ||
    timezone !== (workspace.timezone ?? detectTimeZone())

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await update({ workspaceId: workspace._id, name, slug, icon, timezone })
      // Changing the address changes the workspace URL — move there so the current
      // route (still on the old slug) doesn't fall through to "not found".
      if (result.slug !== workspace.slug) {
        await navigate({ to: '/w/$workspaceId', params: { workspaceId: result.slug } })
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not save'))
    } finally {
      setBusy(false)
    }
  }

  const slugStatus = (): React.JSX.Element | null => {
    if (!slugChanged || slug.length < 2) return null
    if (availability === undefined) {
      return (
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          <Spinner className="size-3" /> Checking…
        </p>
      )
    }
    if (availability.available) {
      return (
        <p className="flex items-center gap-1 text-xs text-success">
          <Check className="size-3.5" weight="bold" /> Available
        </p>
      )
    }
    return (
      <p className="flex items-center gap-1 text-xs text-destructive">
        <Warning className="size-3.5" weight="bold" />
        {availability.reason === 'taken'
          ? 'That address is taken — try another.'
          : availability.reason === 'reserved'
            ? 'That address is reserved.'
            : 'Use lowercase letters, numbers, and hyphens.'}
      </p>
    )
  }

  const uploadWorkspaceLogo = async (file: File): Promise<void> => {
    try {
      const key = await uploadFile(file)
      await setLogo({ workspaceId: workspace._id, key })
    } catch (err) {
      toast.error(errorMessage(err, 'Could not upload the logo'))
    }
  }

  return (
    <div className="grid gap-5">
      <div className="flex items-center gap-3">
        <UploadableAvatar
          size="size-14"
          round={false}
          bordered
          onFile={canManage ? uploadWorkspaceLogo : undefined}
        >
          <WorkspaceGlyph
            image={workspace.imageUrl}
            icon={icon}
            name={name}
            className="size-full text-lg text-foreground"
            iconClassName="size-7"
          />
        </UploadableAvatar>
        <div className="min-w-0 leading-tight">
          <p className="text-sm text-muted-foreground">Workspace logo &amp; icon</p>
          {/* A logo overrides the icon (see WorkspaceGlyph); offer to drop it. */}
          {workspace.imageUrl && canManage ? (
            <button
              type="button"
              onClick={() =>
                void removeLogo({ workspaceId: workspace._id }).catch((err) =>
                  toast.error(errorMessage(err, 'Could not remove the logo'))
                )
              }
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Remove logo
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="ws-settings-name">Name</Label>
        <Input
          id="ws-settings-name"
          value={name}
          disabled={!canManage}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor="ws-settings-slug">Address</Label>
        <div className="flex items-center rounded-md border bg-transparent focus-within:border-ring">
          <span className="pl-3 text-sm text-muted-foreground select-none">/w/</span>
          <Input
            id="ws-settings-slug"
            value={slug}
            disabled={!canManage}
            onChange={(e) => setSlug(toSlug(e.target.value))}
            maxLength={40}
            className="border-0 pl-1 focus-visible:ring-0"
          />
        </div>
        {slugStatus()}
        <span className="text-xs text-muted-foreground">
          Changing this changes the workspace URL — existing links to the old address stop working.
        </span>
      </div>

      <div className="grid gap-2">
        <Label>Icon</Label>
        {canManage ? (
          <IconPickerDialog selectedIcon={icon || undefined} onSelect={setIcon} />
        ) : (
          <div className="flex size-11 items-center justify-center rounded-md border text-foreground">
            <WorkspaceGlyph icon={icon} name={name} className="size-full" iconClassName="size-6" />
          </div>
        )}
        <span className="text-xs text-muted-foreground">
          {workspace.imageUrl
            ? 'A logo is set and takes priority — the icon shows only if you remove it.'
            : 'Pick an icon, or leave blank to use the app logo.'}
        </span>
      </div>

      <div className="grid gap-2">
        <Label>Time zone</Label>
        <TimezoneSelect value={timezone} onChange={setTimezone} disabled={!canManage} />
        <span className="text-xs text-muted-foreground">
          The team&apos;s working clock — it&apos;s {localTimeLabel(timezone)} here. Events are
          scheduled in this zone; each member also sees them in their own.
        </span>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {canManage ? (
        <div>
          <Button onClick={save} disabled={busy || !dirty || name.trim().length < 2 || !slugOk}>
            <BusyLabel busy={busy} busyText="Saving…" idle="Save changes" />
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Only owners and admins can edit these.</p>
      )}
    </div>
  )
}

export function MembersTab({
  workspaceId,
  canManage
}: {
  workspaceId: Id<'workspaces'>
  canManage: boolean
}): React.JSX.Element {
  const members = useQuery(api.members.listByWorkspace, { workspaceId }) ?? []
  const updateRole = useMutation(api.members.updateRole)
  const removeMember = useMutation(api.members.remove)
  const [removeTarget, setRemoveTarget] = useState<{
    id: Id<'workspaceMembers'>
    name: string
  } | null>(null)

  return (
    <ul className="grid gap-1">
      {members.map(({ membership, user }) => {
        const isOwnerRow = membership.role === 'owner'
        const shownName = membership.displayName?.trim() || user.name
        return (
          <li key={membership._id} className="flex items-center gap-3 rounded-lg px-1 py-1.5">
            <Avatar
              initials={initialsOf(shownName)}
              color={user.color ?? FALLBACK_AVATAR_COLOR}
              image={user.avatarUrl}
              className="size-8"
            />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-sm font-medium">{shownName}</div>
              <div className="truncate text-xs text-muted-foreground">{user.email}</div>
            </div>
            {isOwnerRow ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Owner
              </span>
            ) : canManage ? (
              <>
                {/* `items`: without it the trigger prints the raw value — a lowercase
                    `member` rather than "Member". Base UI's `Select.Value` has no other
                    way to know the label. */}
                <Select
                  items={ROLE_LABELS}
                  value={membership.role}
                  onValueChange={(value) =>
                    updateRole({
                      memberId: membership._id,
                      role: value as 'admin' | 'member'
                    })
                  }
                >
                  <SelectTrigger size="sm" className="w-28 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ROLE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${user.name}`}
                  onClick={() => setRemoveTarget({ id: membership._id, name: shownName })}
                >
                  <X className="size-4" />
                </Button>
              </>
            ) : (
              <span className="text-xs text-muted-foreground capitalize">{membership.role}</span>
            )}
          </li>
        )
      })}

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={removeTarget ? `Remove ${removeTarget.name}?` : 'Remove member?'}
        description="They lose access to this workspace until they're invited again."
        confirmLabel="Remove"
        onConfirm={async () => {
          if (removeTarget) await removeMember({ memberId: removeTarget.id })
        }}
      />
    </ul>
  )
}

export function DangerTab({
  workspaceId,
  workspaceName,
  isOwner
}: {
  workspaceId: Id<'workspaces'>
  workspaceName: string
  isOwner: boolean
}): React.JSX.Element {
  const leave = useMutation(api.workspaces.leave)
  const remove = useMutation(api.workspaces.remove)
  const navigate = useNavigate()
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [busy, setBusy] = useState(false)

  // Close the modal before leaving so it doesn't re-open on the next workspace's
  // shell (settingsOpen is global, persisted state).
  const doLeave = async (): Promise<void> => {
    setBusy(true)
    try {
      await leave({ workspaceId })
      setSettingsOpen(false)
      await navigate({ to: '/' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-4">
      {isOwner ? (
        <WorkspaceDeleteCard
          workspaceName={workspaceName}
          description="Permanently removes the workspace and all its channels, messages, and members. This can’t be undone."
          onDelete={async (confirmName) => {
            await remove({ workspaceId, confirmName })
            setSettingsOpen(false)
            await navigate({ to: '/' })
          }}
        />
      ) : (
        <div className="grid gap-2 rounded-xl border p-4">
          <p className="text-sm font-medium">Leave this workspace</p>
          <p className="text-sm text-muted-foreground">
            You&apos;ll lose access until you&apos;re invited again.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-fit"
            disabled={busy}
            onClick={() => setConfirmLeave(true)}
          >
            {busy ? 'Leaving…' : 'Leave workspace'}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title={`Leave ${workspaceName}?`}
        description="You'll lose access to this workspace until you're invited again."
        confirmLabel="Leave workspace"
        onConfirm={doLeave}
      />
    </div>
  )
}
