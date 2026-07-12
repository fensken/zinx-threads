import { useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { toast } from 'sonner'
import { LinkSimple } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import { authEnabled } from '@renderer/lib/auth-client'
import { errorMessage } from '@renderer/lib/convex-error'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/spinner'
import { Logo } from '@renderer/components/layout/logo'
import { OpenInApp } from '@renderer/components/common/open-in-app'

export const Route = createFileRoute('/connect/$token')({
  component: ConnectPage
})

/** Passthrough guard: no Convex provider in a mock build → don't mount the hooks. */
function ConnectPage(): React.JSX.Element {
  if (!authEnabled) {
    return (
      <div className="flex h-dvh w-full flex-col items-center justify-center gap-3 bg-sidebar p-6 text-center">
        <Logo className="size-14 rounded-2xl shadow-lg" />
        <p className="text-sm text-muted-foreground">Invites aren’t available in this build.</p>
      </div>
    )
  }
  return <ConnectPageInner />
}

/** Landing page for an emailed channel-share accept link (`/connect/<token>`). Shows
 *  which workspace shared which channel with yours; the guest workspace's OWNER accepts
 *  or declines. Acceptance is gated server-side on being that owner. */
function ConnectPageInner(): React.JSX.Element {
  const { token } = Route.useParams()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const preview = useQuery(api.sharedChannels.previewByToken, { token })
  const accept = useMutation(api.sharedChannels.acceptByToken)
  const decline = useMutation(api.sharedChannels.declineByToken)

  const onAccept = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await accept({ token })
      await navigate({
        to: '/w/$workspaceId/c/$channelId',
        params: { workspaceId: result.slug, channelId: result.channelId }
      })
    } catch (err) {
      toast.error(errorMessage(err, 'Could not accept'))
      setBusy(false)
    }
  }

  const onDecline = async (): Promise<void> => {
    setBusy(true)
    try {
      await decline({ token })
      await navigate({ to: '/' })
    } catch (err) {
      toast.error(errorMessage(err, 'Could not decline'))
      setBusy(false)
    }
  }

  return (
    <div className="flex h-dvh w-full flex-col items-center justify-center gap-6 bg-sidebar p-6">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-lg">
        <LinkSimple className="size-7" weight="bold" />
      </span>
      {preview === undefined ? (
        <Spinner className="size-6 text-muted-foreground" />
      ) : !preview.valid ? (
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-xl font-bold">This invitation isn’t valid</h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            It may have been withdrawn or already handled.
          </p>
          <Button variant="outline" className="mt-2" onClick={() => void navigate({ to: '/' })}>
            Go home
          </Button>
        </div>
      ) : (
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <h1 className="text-xl font-bold">Shared channel invite</h1>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{preview.ownerWorkspaceName}</span>{' '}
            invited{' '}
            <span className="font-medium text-foreground">{preview.guestWorkspaceName}</span> to the
            shared channel{' '}
            <span className="font-medium text-foreground">#{preview.channelName}</span>.
          </p>

          {preview.status === 'accepted' ? (
            <>
              <p className="text-sm text-muted-foreground">You’ve already accepted this.</p>
              <Button
                className="mt-1"
                onClick={() =>
                  void navigate({
                    to: '/w/$workspaceId',
                    params: { workspaceId: preview.guestWorkspaceSlug }
                  })
                }
              >
                Open workspace
              </Button>
            </>
          ) : preview.isGuestOwner ? (
            <div className="mt-1 flex items-center gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void onDecline()}>
                Decline
              </Button>
              <Button className="min-w-28 gap-2" disabled={busy} onClick={() => void onAccept()}>
                {busy ? <Spinner className="size-4" /> : null}
                Accept
              </Button>
            </div>
          ) : (
            <p className="max-w-sm text-sm text-muted-foreground">
              Only the owner of{' '}
              <span className="font-medium text-foreground">{preview.guestWorkspaceName}</span> can
              accept this. Sign in as the workspace owner to continue.
            </p>
          )}
          {/* Web only: hop to the desktop app if it's installed (falls back to here). */}
          <OpenInApp path={`/connect/${token}`} />
        </div>
      )}
    </div>
  )
}
