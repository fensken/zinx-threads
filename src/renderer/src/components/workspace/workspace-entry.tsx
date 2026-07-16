import { Navigate } from '@tanstack/react-router'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { api } from '@convex/_generated/api'
import { Spinner } from '@renderer/components/ui/spinner'

/** The `/` entry: route the signed-in user to their first workspace, or to the
 *  onboarding picker if they have none. */
export function WorkspaceEntry(): React.JSX.Element {
  const workspaces = useQuery(api.workspaces.myWorkspaces)

  if (workspaces === undefined) {
    return (
      <div className="flex h-full items-center justify-center bg-sidebar">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    )
  }
  if (workspaces.length === 0) {
    return <Navigate to="/workspaces" replace />
  }
  return (
    <Navigate to="/w/$workspaceId" params={{ workspaceId: workspaces[0].workspace.slug }} replace />
  )
}
