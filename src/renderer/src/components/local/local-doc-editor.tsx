import { useCallback } from 'react'
import { useLocalStore } from '@renderer/store/local-store'
import { DocEditor, type DocMetaPatch } from '@renderer/components/doc/doc-editor'

/**
 * The local-mode adapter for a `doc` channel — the same editor the online one renders,
 * persisted to the local store instead of Convex (offline parity).
 *
 * Three things are absent because they need a server, and each is hidden rather than left
 * as a dead affordance: **file uploads** (no object store — the media blocks still take a
 * pasted link and a GIF, which are just URLs), **Unsplash** (a Convex action), and the
 * `@`/`#` autocompletes (there is no directory here, so the triggers are simply inert).
 * Everything else — every block, the cover, the icon, the TOC, the bubble menu — is the same
 * component.
 */
export function LocalDocEditor({
  channelId,
  channelName
}: {
  channelId: string
  channelName: string
}): React.JSX.Element {
  const doc = useLocalStore((state) => state.docs[channelId])
  const saveContent = useLocalStore((state) => state.saveDocContent)
  const saveMeta = useLocalStore((state) => state.saveDocMeta)

  // The store writes synchronously; the editor's save pill just flashes past.
  const onSaveContent = useCallback(
    async (json: string) => saveContent(channelId, json),
    [channelId, saveContent]
  )
  const onSaveMeta = useCallback(
    async (patch: DocMetaPatch) => saveMeta(channelId, patch),
    [channelId, saveMeta]
  )

  return (
    <DocEditor
      // Keyed by the caller, so the editor re-seeds when you switch channels.
      content={doc?.content ?? null}
      title={doc?.title ?? null}
      icon={doc?.icon ?? null}
      cover={doc?.cover ?? null}
      coverY={doc?.coverY ?? null}
      channelName={channelName}
      canWrite
      onSaveContent={onSaveContent}
      onSaveMeta={onSaveMeta}
      allowUnsplash={false}
    />
  )
}
