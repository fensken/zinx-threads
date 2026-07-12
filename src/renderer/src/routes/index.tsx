import { createFileRoute } from '@tanstack/react-router'
import { WorkspaceEntry } from '@renderer/components/workspace/workspace-entry'

// `/` sends the user to their first workspace, or to onboarding if they have
// none (mock server when no backend is configured). See WorkspaceEntry.
export const Route = createFileRoute('/')({
  component: WorkspaceEntry
})
