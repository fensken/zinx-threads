import { useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { Plus, WifiSlash } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { BusyLabel } from '@renderer/components/common/busy-label'
import { AccountMenu } from '@renderer/components/common/account-menu'
import { CreateWorkspaceDialog } from '@renderer/components/workspace/create-workspace-dialog'
import { WorkspaceGlyph } from '@renderer/components/workspace/workspace-glyph'
import { SettingsDialog } from '@renderer/components/settings/settings-dialog'
import { LogoWordmark } from '@renderer/components/layout/logo'
import { errorMessage } from '@renderer/lib/convex-error'
import { parseInviteCode } from '@renderer/lib/invite-links'

export const Route = createFileRoute('/workspaces')({
  component: WorkspacesPage
})

function WorkspacesPage(): React.JSX.Element {
  const workspaces = useQuery(api.workspaces.myWorkspaces)
  const navigate = useNavigate()

  const [createOpen, setCreateOpen] = useState(false)

  const list = workspaces ?? []
  const hasWorkspaces = list.length > 0

  return (
    // `min-h-full` + its own scroller, NOT `min-h-dvh`: the custom title bar means the
    // app's content box is `100dvh` minus the title bar, and asking for a full viewport
    // height inside it overflows a container that clips. Nothing above this scrolls, so
    // with enough workspaces the bottom of the list was simply unreachable.
    <div className="flex min-h-full flex-col overflow-y-auto bg-sidebar">
      <header className="flex items-center justify-between px-6 py-4">
        <LogoWordmark />
        {/* Full account nav — status, edit profile, appearance, sign out — even
            though we're outside any workspace. */}
        <AccountMenu />
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-6 py-10">
        <div className="text-center">
          <h1 className="text-2xl font-bold">
            {hasWorkspaces ? 'Your workspaces' : 'Create your first workspace'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasWorkspaces
              ? 'Pick a workspace to jump back in, or start a new one.'
              : 'Workspaces are where your team chats, plans, and shares. Create one, or join with an invite code.'}
          </p>
        </div>

        {hasWorkspaces ? (
          <ul className="grid gap-2">
            {list.map(({ workspace, role }) => (
              <li key={workspace._id}>
                <button
                  type="button"
                  onClick={() =>
                    navigate({ to: '/w/$workspaceId', params: { workspaceId: workspace.slug } })
                  }
                  className="flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent"
                >
                  <WorkspaceGlyph
                    image={workspace.imageUrl}
                    icon={workspace.icon}
                    name={workspace.name}
                    className="size-10 shrink-0 rounded-lg border text-foreground"
                    iconClassName="size-5"
                  />
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate font-semibold">{workspace.name}</span>
                    <span className="text-xs text-muted-foreground capitalize">{role}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="grid gap-3 rounded-xl border bg-card p-4">
          <Button className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" weight="bold" />
            Create a workspace
          </Button>
          <JoinByCode />
        </div>

        {/* Local, no-account pages + boards that work offline. */}
        <Link
          to="/local"
          className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <WifiSlash className="size-4" />
          Open your local workspace
        </Link>
      </main>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
      {/* No workspace slug → only the user group (My Account + Appearance). Opened by
          the account menu's "Edit profile". */}
      <SettingsDialog />
    </div>
  )
}

/** Redeem an invite **link or code** (`invitations.preview` → `acceptByToken`). The
 *  token — not your email — is the capability, which closes the unverified-email
 *  hole. Accepts a full `/invite/<code>` link (what the invite dialog hands out) or a
 *  bare code; this is the manual fallback to clicking the link. */
function JoinByCode(): React.JSX.Element {
  const acceptByToken = useMutation(api.invitations.acceptByToken)
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const term = parseInviteCode(code)
  const preview = useQuery(api.invitations.preview, term ? { code: term } : 'skip')

  const join = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const { slug } = await acceptByToken({ code: term })
      await navigate({ to: '/w/$workspaceId', params: { workspaceId: slug } })
    } catch (err) {
      setError(errorMessage(err, 'Could not join'))
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2 border-t pt-3">
      <p className="text-center text-xs text-muted-foreground">Have an invite link?</p>
      <div className="flex items-center gap-2">
        <Input
          value={code}
          onChange={(event) => {
            setCode(event.target.value)
            setError(null)
          }}
          placeholder="Paste an invite link or code"
          className="font-mono"
        />
        <Button
          disabled={busy || !term || preview?.valid !== true || preview.alreadyMember}
          onClick={() => void join()}
        >
          <BusyLabel busy={busy} busyText="Joining…" idle="Join" />
        </Button>
      </div>
      {term && preview !== undefined ? (
        preview.valid ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <WorkspaceGlyph
              image={preview.workspaceImageUrl}
              icon={preview.workspaceIcon}
              name={preview.workspaceName}
              className="size-5 rounded"
            />
            {preview.alreadyMember ? (
              <span>
                You&apos;re already in{' '}
                <span className="font-medium text-foreground">{preview.workspaceName}</span>.
              </span>
            ) : (
              <span>
                Join <span className="font-medium text-foreground">{preview.workspaceName}</span>,
                invited by {preview.inviterName}.
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm text-destructive">That invite code isn&apos;t valid.</p>
        )
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
