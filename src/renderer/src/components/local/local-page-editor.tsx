import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { PageEditor, type PageMetaPatch } from '@renderer/components/page/page-editor'
import {
  isEmptyPageContent,
  parsePageContent,
  type PageDoc
} from '@renderer/components/page/page-schema'
import { fileToCoverDataUrl } from '@renderer/lib/local-avatar'
import { useLocalStore } from '@renderer/store/local-store'

/** A local page — the presentational `PageEditor` seeded from + saved to the local
 *  store. The cover picker offers gradients / colors / links **and a device image**
 *  (stored as a downscaled data URL, no upload); only Unsplash is hidden (it needs the
 *  network). Lazy-loaded (BlockNote is a big chunk); keyed per channel by the caller so
 *  BlockNote re-seeds on channel switch.
 *
 *  **Writes to the store are NOT debounced**, deliberately. The store is memory — a
 *  zustand `set()` — and it was never what needed protecting; the *disk* write is
 *  debounced separately (`lib/local-data.ts`, 400ms). A debounce here bought nothing
 *  and cost real data: `useDebouncedCallback` only flushes on unmount, and closing a
 *  window fires `pagehide` **without unmounting React** — so the last ~600ms of typing
 *  sat in a timer that died with the window, while the on-the-way-out flush dutifully
 *  saved the *older* state and reported success. */
export function LocalPageEditor({
  channelId,
  channelName
}: {
  channelId: string
  channelName: string
}): React.JSX.Element {
  const savePageContent = useLocalStore((state) => state.savePageContent)
  const savePageMeta = useLocalStore((state) => state.savePageMeta)
  const renameChannel = useLocalStore((state) => state.renameChannel)

  // Read once, imperatively: BlockNote owns its document after mount, so subscribing
  // would only re-render this component on every keystroke for no benefit. A lazy
  // `useState` initialiser (not a ref) — it runs exactly once, and unlike a ref it
  // isn't a read-during-render.
  const [seed] = useState<PageDoc>(() => {
    const page = useLocalStore.getState().pages[channelId]
    return {
      title: page?.title ?? channelName,
      icon: page?.icon,
      cover: page?.cover,
      coverY: page?.coverY,
      blocks: parsePageContent(page?.content) ?? []
    }
  })

  const pushContent = useCallback(
    (content: string) => {
      // The same guard the Convex editor has (`real-page-editor.tsx`), and for the
      // same reason: BlockNote normalises its document on mount, which fires ONE
      // `onChange` with an empty doc. Without this, opening a page whose file failed
      // to load — truncated, locked by antivirus, corrupt — would open blank and then
      // **overwrite the file with that blank**, destroying a page a human could have
      // repaired. Once a row exists, emptying a page is a real edit and must save.
      const existing = useLocalStore.getState().pages[channelId]
      if (!existing && isEmptyPageContent(content)) return
      savePageContent(channelId, content)
    },
    [savePageContent, channelId]
  )

  const pushMeta = useCallback(
    (patch: PageMetaPatch) => {
      savePageMeta(channelId, patch)
      // Offline has no separate slug — the page title IS the channel's name, so keep
      // the sidebar/header label in step as the title is edited.
      if (patch.title !== undefined) renameChannel(channelId, patch.title)
    },
    [savePageMeta, renameChannel, channelId]
  )

  // Pick a cover from the device — downscaled to a data URL and saved to the store (no
  // upload). The editor only reflects the returned URL in its own state (the online path
  // persists via a mutation), so we persist it here.
  const handleCoverUpload = useCallback(
    async (file: File): Promise<string> => {
      try {
        const url = await fileToCoverDataUrl(file)
        savePageMeta(channelId, { cover: url, coverY: 50 })
        return url
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not use that image')
        throw error
      }
    },
    [savePageMeta, channelId]
  )

  return (
    <PageEditor
      key={channelId}
      doc={seed}
      onContentChange={pushContent}
      onMetaChange={pushMeta}
      onCoverUpload={handleCoverUpload}
      // Offline: a device image works (data URL, above), but Unsplash needs the network,
      // so it stays hidden — gradients / colors / links / upload all work.
      allowNetworkCovers={false}
    />
  )
}
