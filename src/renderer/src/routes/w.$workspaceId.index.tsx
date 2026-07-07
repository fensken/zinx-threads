import { createFileRoute, redirect } from '@tanstack/react-router'
import { getChannels } from '@renderer/data/workspaces'

export const Route = createFileRoute('/w/$workspaceId/')({
  beforeLoad: ({ params }) => {
    const channels = getChannels(params.workspaceId)
    const target =
      channels.find((c) => c.kind === 'chat' && (c.id === 'zinx' || c.id === 'general')) ??
      channels.find((c) => c.kind === 'chat') ??
      channels[0]
    if (target) {
      throw redirect({
        to: '/w/$workspaceId/c/$channelId',
        params: { workspaceId: params.workspaceId, channelId: target.id }
      })
    }
  }
})
