import { createFileRoute } from '@tanstack/react-router'
import { InboxPage } from '@renderer/components/inbox/inbox-page'

// The Inbox page. It sits under `/w/<workspace>` so it keeps the shell — the sidebar,
// the workspace switcher, somewhere to go next — but its **content is user-wide**:
// notifications from every workspace you belong to (see `convex/inbox.ts`). The
// workspace in the URL is where you happen to be standing, not a filter.
export const Route = createFileRoute('/w/$workspaceId/inbox')({
  component: InboxRoute
})

function InboxRoute(): React.JSX.Element {
  return <InboxPage />
}
