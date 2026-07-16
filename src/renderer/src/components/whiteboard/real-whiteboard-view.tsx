import { useCallback } from 'react'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { LoadingBlock } from '@renderer/components/common/loading-block'
import { WhiteboardView } from '@renderer/components/whiteboard/whiteboard-view'

/** A Convex-backed `whiteboard` channel. Thin adapter — the canvas is presentational
 *  (`WhiteboardView`), exactly as `RealBoardView` wraps `BoardView`. */
export function RealWhiteboardView({
  channelId
}: {
  channelId: Id<'channels'>
}): React.JSX.Element {
  const board = useQuery(api.whiteboards.getByChannel, { channelId })
  const save = useMutation(api.whiteboards.save)

  const onSave = useCallback(
    async (scene: { json: string; count: number }) => {
      await save({ channelId, elements: scene.json, elementCount: scene.count })
    },
    [save, channelId]
  )

  // The canvas seeds itself once, at mount — so it must not be mounted until the scene is
  // actually here, or it would seed empty and never re-seed. `undefined` = loading;
  // `null` = loaded, nothing drawn yet (an empty board, which IS ready to mount).
  if (board === undefined) return <LoadingBlock />

  return <WhiteboardView elements={board?.elements ?? '[]'} onSave={onSave} />
}
