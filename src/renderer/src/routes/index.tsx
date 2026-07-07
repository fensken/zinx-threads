import { createFileRoute, redirect } from '@tanstack/react-router'
import { servers } from '@renderer/data/workspaces'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/w/$workspaceId', params: { workspaceId: servers[0].id } })
  }
})
