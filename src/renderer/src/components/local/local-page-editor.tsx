import { useCallback } from 'react'
import { PageEditor, type PageMetaPatch } from '@renderer/components/page/page-editor'
import { parsePageContent, type PageDoc } from '@renderer/components/page/page-schema'
import { useLocalStore } from '@renderer/store/local-store'
import { useDebouncedCallback } from '@renderer/lib/use-debounced-callback'

/** Debounce writes so a burst of typing (or a cover-reposition drag, which fires per
 *  pointermove) is one localStorage write — the persist middleware serialises the
 *  whole store per set(). Both flush on unmount. */
const CONTENT_DEBOUNCE_MS = 600
const META_DEBOUNCE_MS = 500

/** Meta patches are COALESCED, not last-write-wins — typing a title then picking an
 *  icon inside one debounce window must save both. */
function mergeMeta(previous: PageMetaPatch, next: PageMetaPatch): PageMetaPatch {
  return { ...previous, ...next }
}

/** A local (offline) page — the presentational `PageEditor` seeded from + saved to
 *  the local store. No cover **upload** (that needs R2/an account); the cover picker
 *  still offers gradients / colors / links. Lazy-loaded (BlockNote is a big chunk).
 *  Keyed per channel by the caller so BlockNote re-seeds on channel switch. */
export function LocalPageEditor({
  channelId,
  channelName
}: {
  channelId: string
  channelName: string
}): React.JSX.Element {
  const page = useLocalStore((state) => state.pages[channelId])
  const savePageContent = useLocalStore((state) => state.savePageContent)
  const savePageMeta = useLocalStore((state) => state.savePageMeta)
  const renameChannel = useLocalStore((state) => state.renameChannel)

  // Seeded once (BlockNote owns its state after mount); the editor is keyed per channel.
  const doc: PageDoc = {
    title: page?.title ?? channelName,
    icon: page?.icon,
    cover: page?.cover,
    coverY: page?.coverY,
    blocks: parsePageContent(page?.content) ?? []
  }

  const pushContent = useDebouncedCallback<string>(
    useCallback(
      (content: string) => savePageContent(channelId, content),
      [savePageContent, channelId]
    ),
    CONTENT_DEBOUNCE_MS
  )

  const pushMeta = useDebouncedCallback<PageMetaPatch>(
    useCallback(
      (patch: PageMetaPatch) => {
        savePageMeta(channelId, patch)
        // Offline has no separate slug — the page title IS the channel's name, so keep
        // the sidebar/header label in step as the title is edited.
        if (patch.title !== undefined) renameChannel(channelId, patch.title)
      },
      [savePageMeta, renameChannel, channelId]
    ),
    META_DEBOUNCE_MS,
    mergeMeta
  )

  return (
    <PageEditor
      key={channelId}
      doc={doc}
      onContentChange={pushContent}
      onMetaChange={pushMeta}
      // Offline: no cover upload (needs R2) and no Unsplash (needs the network) —
      // gradients / colors / links still work.
      allowNetworkCovers={false}
    />
  )
}
