import { useCallback } from 'react'
import { WhiteboardView } from '@renderer/components/whiteboard/whiteboard-view'
import { useLocalStore } from '@renderer/store/local-store'

/** An offline `whiteboard` channel — the offline-parity rule: everything that can work
 *  without a server does, and looks the same minus the online-only parts. Here there are
 *  none: a whiteboard is just a canvas and a file. */
export function LocalWhiteboardView({ channelId }: { channelId: string }): React.JSX.Element {
  const elements = useLocalStore((state) => state.whiteboards[channelId]?.elements)
  const saveWhiteboard = useLocalStore((state) => state.saveWhiteboard)

  const onSave = useCallback(
    (scene: { json: string; count: number }) => {
      // Straight into the store — which is memory. The *disk* write is debounced
      // separately (`lib/local-data.ts`, 400ms) and flushes on quit, so there is nothing
      // to debounce again here.
      saveWhiteboard(channelId, { elements: scene.json, elementCount: scene.count })
    },
    [saveWhiteboard, channelId]
  )

  // The store is hydrated before the offline shell renders, so a missing row means
  // "nothing drawn yet", never "still loading" — hence `?? '[]'` rather than `undefined`.
  return <WhiteboardView elements={elements ?? '[]'} onSave={onSave} />
}
