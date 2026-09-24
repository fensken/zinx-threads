import { useCallback } from 'react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { useMutation } from 'convex/react'
import { useUploadFile } from '@convex-dev/r2/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'

import { DocEditor, type DocMetaPatch } from '@renderer/components/doc/doc-editor'
import { DocSkeleton } from '@renderer/components/common/skeletons'

/**
 * The Convex adapter for a `doc` channel — persistence only; `DocEditor` owns the UI.
 *
 * It holds the document until it has actually loaded before mounting the editor. That's not
 * a nicety: the editor seeds its content once, at mount, so an editor mounted against a
 * placeholder would show an empty document over a saved one and then never re-seed. Same
 * rule as `RealWhiteboardView`.
 */
export function RealDocEditor({
  channelId,
  channelName
}: {
  channelId: Id<'channels'>
  channelName: string
}): React.JSX.Element {
  const doc = useQuery(api.docs.getByChannel, { channelId })
  const save = useMutation(api.docs.save)
  const saveMeta = useMutation(api.docs.saveMeta)
  const setCoverUpload = useMutation(api.docs.setCoverUpload)
  const resolveUpload = useMutation(api.docs.resolveUpload)
  const uploadFile = useUploadFile(api.files)

  const onSaveContent = useCallback(
    (json: string) => save({ channelId, content: json }),
    [channelId, save]
  )
  const onSaveMeta = useCallback(
    (patch: DocMetaPatch) => saveMeta({ channelId, ...patch }),
    [channelId, saveMeta]
  )
  // The browser PUTs straight to R2 and gets back an object KEY; the mutation claims it
  // (ownership-checked) and resolves the durable URL. The renderer never signs anything.
  const onUpload = useCallback(
    async (file: File) => resolveUpload({ channelId, key: await uploadFile(file) }),
    [channelId, resolveUpload, uploadFile]
  )
  const onUploadCover = useCallback(
    async (file: File) => setCoverUpload({ channelId, key: await uploadFile(file) }),
    [channelId, setCoverUpload, uploadFile]
  )

  if (doc === undefined) return <DocSkeleton />
  // `null` = signed out, or no access. The channel wouldn't be listed either, so this is
  // the guest/permission race rather than a state the reader lands in.
  if (doc === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
        You don&apos;t have access to this doc.
      </div>
    )
  }

  return (
    <DocEditor
      content={doc.content}
      title={doc.title}
      icon={doc.icon}
      cover={doc.cover}
      coverY={doc.coverY}
      channelName={channelName}
      canWrite={doc.canWrite}
      onSaveContent={onSaveContent}
      onSaveMeta={onSaveMeta}
      onUpload={onUpload}
      onUploadCover={onUploadCover}
    />
  )
}

export default RealDocEditor
