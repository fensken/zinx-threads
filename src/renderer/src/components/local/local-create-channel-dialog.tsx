import { useNavigate } from '@tanstack/react-router'
import { useLocalStore, type LocalChannelKind } from '@renderer/store/local-store'
import {
  CreateChannelDialogView,
  type ChannelDialogKind
} from '@renderer/components/chat/create-channel-dialog'

/** The three channel kinds that work with no server. */
const LOCAL_KINDS: ChannelDialogKind[] = ['page', 'kanban', 'whiteboard']

/** Create a local page/board/whiteboard — renders the **same** `CreateChannelDialogView`
 *  as the online app, just narrowed to the server-free kinds and with the private toggle
 *  hidden (visibility needs a server). Same UI, no fork. */
export function LocalCreateChannelDialog({
  groupId,
  open,
  onOpenChange
}: {
  /** Create it inside this group, or ungrouped when absent. */
  groupId?: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const createChannel = useLocalStore((state) => state.createChannel)
  const navigate = useNavigate()

  return (
    <CreateChannelDialogView
      open={open}
      onOpenChange={onOpenChange}
      kinds={LOCAL_KINDS}
      allowPrivate={false}
      description="Pages, boards and whiteboards are stored locally on this device."
      onSubmit={({ name, kind }) => {
        const id = createChannel(name, kind as LocalChannelKind, groupId)
        onOpenChange(false)
        void navigate({ to: '/local/$channelId', params: { channelId: id } })
      }}
    />
  )
}
