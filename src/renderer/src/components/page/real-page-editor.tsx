import { useCallback, useEffect, useState } from 'react'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { useUploadFile } from '@convex-dev/r2/react'
import { CheckCircle, CloudArrowUp, WarningCircle } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Doc, Id } from '@convex/_generated/dataModel'
import { PageEditor, type PageMetaPatch } from '@renderer/components/page/page-editor'
import {
  isEmptyPageContent,
  parsePageContent,
  type PageDoc
} from '@renderer/components/page/page-schema'
import { PageSkeleton } from '@renderer/components/common/skeletons'
import { errorMessage } from '@renderer/lib/convex-error'
import { MAX_UPLOAD_LABEL, withinUploadLimit } from '@renderer/lib/upload-limits'
import { useDebouncedCallback } from '@renderer/lib/use-debounced-callback'

/** Long enough that a burst of typing is one write, short enough that a quick
 *  tab-away still lands (the debounce also flushes on unmount). */
const CONTENT_DEBOUNCE_MS = 800
const META_DEBOUNCE_MS = 500

/** How long "Saved" lingers before the pill gets out of the way. Errors never
 *  auto-dismiss — an unsaved edit has to stay visible. */
const SAVED_LINGER_MS = 2000

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/** Module scope: a stable identity, so the debounce never re-arms on re-render. */
function mergeMeta(previous: PageMetaPatch, next: PageMetaPatch): PageMetaPatch {
  return { ...previous, ...next }
}

/** A `page` channel, persisted to Convex.
 *
 *  Edits are **last-write-wins** — there's no CRDT, so two people editing the same
 *  page at once will clobber each other. Real multiplayer needs y.js and is a
 *  separate project.
 *
 *  The editor is seeded once from the loaded row (BlockNote owns its state after
 *  mount), so this must be keyed per channel by the caller. */
export function RealPageEditor({ channel }: { channel: Doc<'channels'> }): React.JSX.Element {
  const page = useQuery(api.pages.getByChannel, { channelId: channel._id })

  if (page === undefined) return <PageSkeleton />

  // `null` = nothing written yet. Start from an empty document titled after the
  // channel; the first real edit creates the row.
  const doc: PageDoc = {
    title: page?.title ?? channel.name,
    icon: page?.icon,
    cover: page?.cover,
    coverY: page?.coverY,
    blocks: parsePageContent(page?.content) ?? []
  }

  return <PageSurface channelId={channel._id} doc={doc} hasRow={page !== null} />
}

function PageSurface({
  channelId,
  doc,
  hasRow
}: {
  channelId: Id<'channels'>
  doc: PageDoc
  /** A `pages` row already exists — so an emptied document must still be saved. */
  hasRow: boolean
}): React.JSX.Element {
  const saveContent = useMutation(api.pages.saveContent)
  const saveMeta = useMutation(api.pages.saveMeta)
  const uploadFile = useUploadFile(api.files)
  const setCoverUpload = useMutation(api.pages.setCoverUpload)
  const resolveUpload = useMutation(api.files.resolveUpload)
  const [state, setState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async (action: Promise<unknown>): Promise<void> => {
    setState('saving')
    try {
      await action
      setState('saved')
      setError(null)
    } catch (caught) {
      // Never silently lose an edit — say so, and keep saying so.
      setState('error')
      setError(errorMessage(caught, 'Could not save this page'))
    }
  }, [])

  // Let "Saved" fade; leave "Saving…" and errors alone.
  useEffect(() => {
    if (state !== 'saved') return
    const timer = setTimeout(() => setState('idle'), SAVED_LINGER_MS)
    return () => clearTimeout(timer)
  }, [state])

  const pushContent = useDebouncedCallback<string>(
    useCallback(
      (content: string) => {
        // Don't materialise a row for a page nobody has touched — BlockNote
        // normalises its document on mount, which fires one `onChange`. Once a
        // row exists an empty document is a real edit and must be saved.
        if (!hasRow && isEmptyPageContent(content)) return
        void run(saveContent({ channelId, content }))
      },
      [run, saveContent, channelId, hasRow]
    ),
    CONTENT_DEBOUNCE_MS
  )

  // Meta calls are *patches*, so coalesce them rather than keeping the last one:
  // typing a title and then picking an icon inside one window must save both.
  const pushMeta = useDebouncedCallback<PageMetaPatch>(
    useCallback(
      (patch: PageMetaPatch) => void run(saveMeta({ channelId, ...patch })),
      [run, saveMeta, channelId]
    ),
    META_DEBOUNCE_MS,
    mergeMeta
  )

  // A file dropped/selected in a page BLOCK (image / file / audio / video): upload to R2,
  // then adopt it + resolve a durable URL (`files.resolveUpload`). BlockNote stores that
  // URL in the block; the page autosaves the content around it. BlockNote surfaces upload
  // errors in the block itself, so we just let it throw.
  const uploadBlockFile = useCallback(
    async (file: File): Promise<string> => {
      // Keep total storage bounded. BlockNote surfaces this throw in the block.
      if (!withinUploadLimit(file.size)) {
        throw new Error(`That file is larger than ${MAX_UPLOAD_LABEL}`)
      }
      const key = await uploadFile(file)
      return await resolveUpload({ key, channelId })
    },
    [uploadFile, resolveUpload, channelId]
  )

  // Cover upload persists itself (`setCoverUpload` resolves the URL + tracks the
  // R2 key + deletes the previous cover). Returns the URL for the local preview.
  const uploadCover = useCallback(
    async (file: File): Promise<string> => {
      setState('saving')
      try {
        const key = await uploadFile(file)
        const url = await setCoverUpload({ channelId, key })
        setState('saved')
        setError(null)
        return url
      } catch (caught) {
        setState('error')
        setError(errorMessage(caught, 'Could not upload the cover'))
        throw caught
      }
    },
    [uploadFile, setCoverUpload, channelId]
  )

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <SaveIndicator state={state} error={error} />
      <PageEditor
        key={channelId}
        doc={doc}
        onContentChange={pushContent}
        onMetaChange={pushMeta}
        onCoverUpload={uploadCover}
        onUploadFile={uploadBlockFile}
      />
    </div>
  )
}

/** A quiet status pill — Notion/Google Docs style. Silent until the first save,
 *  loud (and persistent) if one fails.
 *
 *  **Bottom** right, not top: the cover's own "Change cover / Reposition / Remove"
 *  buttons live at the top-right of the cover image, and the table-of-contents rail
 *  runs down the vertical middle of the right edge. This corner is the only one
 *  nothing else claims. */
function SaveIndicator({
  state,
  error
}: {
  state: SaveState
  error: string | null
}): React.JSX.Element | null {
  if (state === 'idle') return null

  if (state === 'error') {
    return (
      <div className="absolute right-4 bottom-4 z-20 flex items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-1 text-xs text-destructive shadow-sm">
        <WarningCircle className="size-3.5" weight="fill" />
        {error ?? 'Not saved'}
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute right-4 bottom-4 z-20 flex items-center gap-1.5 rounded-full border bg-popover/90 px-2.5 py-1 text-xs text-muted-foreground shadow-sm">
      {state === 'saving' ? (
        <>
          <CloudArrowUp className="size-3.5" />
          Saving…
        </>
      ) : (
        <>
          <CheckCircle className="size-3.5" weight="fill" />
          Saved
        </>
      )}
    </div>
  )
}
