import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { toast } from 'sonner'
import { api } from '@convex/_generated/api'
import { authEnabled } from '@renderer/lib/auth-client'
import { errorMessage } from '@renderer/lib/convex-error'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/spinner'
import { Logo } from '@renderer/components/layout/logo'
import { WorkspaceGlyph } from '@renderer/components/workspace/workspace-glyph'
import { OpenInApp } from '@renderer/components/common/open-in-app'

export const Route = createFileRoute('/invite/$code')({
  component: InvitePage
})

/** Passthrough guard: in a no-backend (mock) build there's no Convex provider, so the
 *  inner component — which calls Convex hooks — must not mount. */
function InvitePage(): React.JSX.Element {
  if (!authEnabled) {
    return (
      <div className="flex h-dvh w-full flex-col items-center justify-center gap-3 bg-sidebar p-6 text-center">
        <Logo className="size-14 rounded-2xl shadow-lg" />
        <p className="text-sm text-muted-foreground">Invites aren’t available in this build.</p>
      </div>
    )
  }
  return <InvitePageInner />
}

/** Landing page for an emailed workspace-invite link (`/invite/<code>`). Previews the
 *  workspace, then redeems the token → joins → navigates in. The token is the
 *  capability (email is never authorization). Web-only in practice; the desktop email
 *  path is copy-the-code (see the invite email). */
function InvitePageInner(): React.JSX.Element {
  const { code } = Route.useParams()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const preview = useQuery(api.invitations.preview, { code })
  const acceptByToken = useMutation(api.invitations.acceptByToken)

  const join = async (): Promise<void> => {
    setBusy(true)
    try {
      const { slug } = await acceptByToken({ code })
      await navigate({ to: '/w/$workspaceId', params: { workspaceId: slug } })
    } catch (error) {
      toast.error(errorMessage(error, 'Could not join the workspace'))
      setBusy(false)
    }
  }

  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-6 bg-sidebar p-6">
      <Logo className="size-14 rounded-2xl shadow-lg" />
      {preview === undefined ? (
        <Spinner className="size-6 text-muted-foreground" />
      ) : !preview.valid ? (
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-xl font-bold">This invite isn’t valid</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            The link may have been revoked or already used. Ask for a new one.
          </p>
          <Button variant="outline" className="mt-2" onClick={() => void navigate({ to: '/' })}>
            Go home
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-center">
          <WorkspaceGlyph
            image={preview.workspaceImageUrl}
            icon={preview.workspaceIcon}
            name={preview.workspaceName}
            className="size-16 text-2xl"
          />
          <h1 className="text-xl font-bold">{preview.workspaceName}</h1>
          {preview.alreadyMember ? (
            <>
              <p className="text-sm text-muted-foreground">You’re already a member.</p>
              <Button
                className="mt-1"
                onClick={() =>
                  void navigate({
                    to: '/w/$workspaceId',
                    params: { workspaceId: preview.workspaceSlug }
                  })
                }
              >
                Open workspace
              </Button>
            </>
          ) : preview.expired ? (
            <p className="max-w-sm text-sm text-muted-foreground">
              This invite link has expired. Ask for a new one.
            </p>
          ) : preview.emailRestricted && !preview.emailAllowed ? (
            <p className="max-w-sm text-sm text-muted-foreground">
              This invite is restricted to specific email addresses, and your account isn’t on the
              list. Ask the person who invited you to add your email.
            </p>
          ) : (
            <>
              <p className="max-w-sm text-sm text-muted-foreground">
                Invited by {preview.inviterName}. Join to start collaborating.
              </p>
              <Button className="mt-1 min-w-40 gap-2" disabled={busy} onClick={() => void join()}>
                {busy ? <Spinner className="size-4" /> : null}
                Join workspace
              </Button>
            </>
          )}
          {/* Web only: hop to the desktop app if it's installed (falls back to here). */}
          <OpenInApp path={`/invite/${code}`} />
        </div>
      )}
    </div>
  )
}
