import { useState } from 'react'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { useUploadFile } from '@convex-dev/r2/react'
import { toast } from 'sonner'
import { api } from '@convex/_generated/api'
import type { Doc } from '@convex/_generated/dataModel'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/spinner'
import { Avatar } from '@renderer/components/common/avatar'
import { UploadableAvatar } from '@renderer/components/common/uploadable-avatar'
import { AuthControls } from '@renderer/components/auth/auth-controls'
import { errorMessage } from '@renderer/lib/convex-error'

// Avatar palette (categorical colors — allowed hardcoded exception).
const SWATCHES = [
  '#5865f2',
  '#3ba55d',
  '#eb459e',
  '#faa61a',
  '#00a8fc',
  '#e67e22',
  '#8b5cf6',
  '#e74c3c'
]

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Global account profile editor (display name + avatar color) + WorkOS session
 *  controls. Only mount when `authEnabled` (it uses Convex + WorkOS hooks). This
 *  is the account-wide identity; per-workspace nicknames live in workspace
 *  settings → My profile. */
export function AccountControls(): React.JSX.Element {
  const me = useQuery(api.users.me)

  if (me === undefined) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Loading your profile…
      </div>
    )
  }
  // Row not stored yet (first-login race) — just offer the session controls.
  if (me === null) return <AuthControls />

  return <ProfileForm key={me._id} me={me} />
}

function ProfileForm({ me }: { me: Doc<'users'> }): React.JSX.Element {
  const updateProfile = useMutation(api.users.updateProfile)
  // `useUploadFile` uploads straight to R2 (signed PUT) and returns the object
  // key; `setUploadedAvatar` then adopts it as the account avatar.
  const uploadFile = useUploadFile(api.files)
  const setUploadedAvatar = useMutation(api.users.setUploadedAvatar)
  const [name, setName] = useState(me.name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const color = me.color ?? SWATCHES[0]
  const preview = name.trim() || me.email
  const dirty = name !== (me.name ?? '')

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await updateProfile({ name })
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
    <div className="grid gap-4">
      <div className="flex items-center gap-3">
        <UploadableAvatar size="size-14" onFile={uploadAvatar}>
          <Avatar
            initials={initialsOf(preview)}
            color={color}
            image={me.avatarUrl}
            className="size-full text-base"
          />
        </UploadableAvatar>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold">{preview}</div>
          <div className="truncate text-xs text-muted-foreground">{me.email}</div>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="account-name">Display name</Label>
        <Input
          id="account-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={me.email}
          maxLength={60}
        />
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy || !dirty} className="gap-2">
          {busy ? (
            <>
              <Spinner className="size-4" />
              Saving…
            </>
          ) : (
            'Save profile'
          )}
        </Button>
      </div>

      <div className="border-t pt-3">
        <AuthControls />
      </div>
    </div>
  )
}
