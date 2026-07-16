import { useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { api } from '@convex/_generated/api'
import { useUiStore } from '@renderer/store/ui-store'

export type InboxItem = FunctionReturnType<typeof api.inbox.listForMe>[number]

/** Opening an inbox row: clear it, then go to where it happened.
 *
 *  The row carries **its own workspace** (the inbox spans all of them), so this can
 *  cross workspaces — which is the point of a user-level inbox, and the reason the
 *  target is computed from the item rather than from whatever route you're on. */
export function useOpenInboxItem(): (item: InboxItem) => void {
  const navigate = useNavigate()
  const markRead = useMutation(api.inbox.markRead)
  const openThread = useUiStore((state) => state.openThread)

  return (item: InboxItem) => {
    void markRead({ notificationId: item._id })

    if (item.channelKind === 'dm') {
      // A conversation has no slug — it's addressed by id.
      void navigate({
        to: '/w/$workspaceId/d/$channelId',
        params: { workspaceId: item.workspaceSlug, channelId: item.channelId }
      })
      return
    }

    void navigate({
      to: '/w/$workspaceId/$channelSlug',
      params: { workspaceId: item.workspaceSlug, channelSlug: item.channelName }
    })
    // A thread notification lands you *in* the thread, not merely in its channel.
    if (item.threadId) openThread(item.threadId)
  }
}
