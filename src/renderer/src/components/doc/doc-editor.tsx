import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import DragHandle from '@tiptap/extension-drag-handle-react'
import { ArrowsOutSimple, ImageSquare, Plus, Smiley } from '@phosphor-icons/react'
import { toast } from 'sonner'

import { Button } from '@renderer/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { EmojiPickerPanel } from '@renderer/components/pickers/emoji-picker'
import { SaveStatus } from '@renderer/components/common/save-status'
import { useSaveStatus } from '@renderer/lib/use-save-status'
import { useDebouncedCallback } from '@renderer/lib/use-debounced-callback'
import { useWorkspaceDirectory } from '@renderer/components/chat/workspace-directory-context'
import { DocCover } from '@renderer/components/doc/doc-cover'
import { DocCoverPicker } from '@renderer/components/doc/doc-cover-picker'
import { DocToc } from '@renderer/components/doc/doc-toc'
import { DocBubbleMenu } from '@renderer/components/doc/doc-bubble-menu'
import { DEFAULT_COVER_Y } from '@renderer/components/doc/cover-data'
import {
  buildDocExtensions,
  isEmptyDocContent,
  parseDocContent,
  type DocSources
} from '@renderer/components/doc/doc-extensions'
import type { MentionChannel, MentionMember } from '@renderer/lib/tiptap-mention'
import { errorMessage } from '@renderer/lib/convex-error'
import { cn } from '@renderer/lib/utils'
import '@renderer/components/doc/doc-editor.css'

/**
 * A `doc` channel: a Notion-style block document. The channel IS the page.
 *
 * **Presentational** — content and chrome come in, edits go out. `real-doc-editor.tsx` and
 * `local-doc-editor.tsx` supply the persistence, exactly as `BoardView` and `WhiteboardView`
 * do for their kinds.
 *
 * The caller must key this per channel AND mount it only once the document has loaded: the
 * editor seeds its content once, at mount, so mounting against a placeholder would open an
 * empty document over a saved one.
 */

const CONTENT_DEBOUNCE_MS = 800
const META_DEBOUNCE_MS = 500

export interface DocMetaPatch {
  title?: string
  icon?: string | null
  cover?: string | null
  coverY?: number
}

export interface DocEditorProps {
  /** The stored ProseMirror JSON, or `null` when nothing has been written yet. */
  content: string | null
  title: string | null
  icon: string | null
  cover: string | null
  coverY: number | null
  /** Falls back to this when the doc has no title of its own. */
  channelName: string
  canWrite: boolean
  onSaveContent: (json: string) => Promise<unknown>
  onSaveMeta: (patch: DocMetaPatch) => Promise<unknown>
  /** Upload a file from inside the document and resolve its durable URL. Absent → the media
   *  blocks offer only "embed a link" (local mode has no object store). */
  onUpload?: (file: File) => Promise<string>
  /** Upload a cover image and resolve its URL. Absent → the picker hides its Upload tab. */
  onUploadCover?: (file: File) => Promise<string>
  /** Unsplash needs the Convex action — off in local mode. */
  allowUnsplash?: boolean
}

export function DocEditor({
  content,
  title: initialTitle,
  icon: initialIcon,
  cover: initialCover,
  coverY: initialCoverY,
  channelName,
  canWrite,
  onSaveContent,
  onSaveMeta,
  onUpload,
  onUploadCover,
  allowUnsplash = true
}: DocEditorProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { state, track } = useSaveStatus()
  // The reason a save failed, shown in the pill — 'Not saved' alone can't tell you whether
  // retrying would help.
  const [error, setError] = useState<string | null>(null)

  // Chrome is local state seeded ONCE — re-syncing it from the query would fight the user's
  // typing on every save round-trip.
  const [title, setTitle] = useState(initialTitle ?? channelName)
  const [icon, setIcon] = useState(initialIcon ?? '')
  const [cover, setCover] = useState(initialCover ?? '')
  const [coverY, setCoverY] = useState(initialCoverY ?? DEFAULT_COVER_Y)
  const [coverPickerOpen, setCoverPickerOpen] = useState(false)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [bookmarkOpen, setBookmarkOpen] = useState(false)
  const [bookmarkUrl, setBookmarkUrl] = useState('')

  // Caret rect for the `/emoji` popup. Non-null means "open". The rect comes from the slash
  // command itself, which already has the editor in hand.
  const [emojiAnchor, setEmojiAnchor] = useState<DOMRect | null>(null)
  const openEmoji = useCallback((anchor?: DOMRect) => setEmojiAnchor(anchor ?? null), [])
  const openBookmark = useCallback(() => {
    setBookmarkUrl('')
    setBookmarkOpen(true)
  }, [])

  const canWriteRef = useRef(canWrite)
  useEffect(() => {
    canWriteRef.current = canWrite
  }, [canWrite])

  // ── The `@` / `#` catalogues ────────────────────────────────────────────
  // Read through a REF, never captured by value: the editor is built once (see the memo
  // below), so a directory that resolves a moment after mount would otherwise leave the
  // autocompletes permanently empty. Same reason the chat composer uses a ref.
  const directory = useWorkspaceDirectory()
  const sources = useRef<DocSources>({ members: [], channels: [], canModerate: false })

  const members = useMemo<MentionMember[]>(
    () =>
      (directory?.members ?? []).map((member) => ({
        id: member.userId,
        name: member.name,
        subtitle: member.statusText?.trim() || member.email,
        color: member.color,
        avatarUrl: member.avatarUrl
      })),
    [directory?.members]
  )
  const channels = useMemo<MentionChannel[]>(
    () =>
      (directory?.channels ?? []).map((channel) => ({
        id: channel.id,
        name: channel.name,
        kind: channel.kind
      })),
    [directory?.channels]
  )

  useEffect(() => {
    sources.current = { members, channels, canModerate: directory?.canModerate ?? false }
  }, [members, channels, directory?.canModerate])

  // ── Content saving ──────────────────────────────────────────────────────
  const lastSaved = useRef(content ?? '')
  // **Did the editor start from content it could read?** This, not "does a row exist", is
  // what gates the first write. An editor that opens blank fires one normalisation
  // `update`, and treating that as a user edit would save the blank over a stored document
  // the parser merely failed to read. (This exact hole destroyed pages once already.)
  const loadedContent = useRef(parseDocContent(content) !== undefined)

  const persist = useDebouncedCallback<string>((json) => {
    void track(onSaveContent(json))
      .then(() => {
        // Marked saved only AFTER the write lands — otherwise a rejected save is silently
        // forgotten, with nothing left to retry it.
        lastSaved.current = json
        loadedContent.current = true
        setError(null)
      })
      .catch((caught) => {
        // The pill names the reason ("This doc is too large to save"), so a toast per
        // keystroke would just repeat it.
        setError(errorMessage(caught, "Couldn't save this doc"))
      })
  }, CONTENT_DEBOUNCE_MS)

  // ── Meta saving ─────────────────────────────────────────────────────────
  // Patches MERGE within the window: typing a title and then picking an icon inside the
  // same 500ms must not drop the title.
  const persistMeta = useDebouncedCallback<DocMetaPatch>(
    (patch) => {
      void track(onSaveMeta(patch))
        .then(() => setError(null))
        .catch((caught) => setError(errorMessage(caught, "Couldn't save this doc")))
    },
    META_DEBOUNCE_MS,
    (previous, next) => ({ ...previous, ...next })
  )

  const upload = useCallback(
    async (file: File): Promise<string> => {
      if (!onUpload) throw new Error('Uploads are unavailable here')
      return await onUpload(file)
    },
    [onUpload]
  )

  // MEMOISED DELIBERATELY — correctness, not performance. `useEditor` compares `extensions`
  // by IDENTITY, element by element, and `buildDocExtensions` mints fresh instances every
  // call. Called inline, that comparison fails on every render and TipTap responds with
  // `editor.setOptions(...)`, which rebuilds the schema and destroys and recreates every
  // node view — tearing down a whiteboard canvas mid-stroke and a video player mid-load.
  //
  // Every dependency here is genuinely stable: `sources` is a ref, `openEmoji`/`openBookmark`
  // are empty-dep callbacks, and `upload` closes over a prop the caller keys per channel.
  /* eslint-disable react-hooks/refs -- TipTap reads `sources` only from editor events
     (opening an autocomplete), never during React render. Reading the catalogues through a
     ref is what lets the editor be built once: rebuilding it when the member list finally
     loads would tear down every node view mid-edit. */
  const extensions = useMemo(
    () => buildDocExtensions({ sources, upload, openEmoji, openBookmark }),
    [upload, openEmoji, openBookmark]
  )
  /* eslint-enable react-hooks/refs */

  const editor = useEditor({
    editable: canWrite,
    extensions,
    content: parseDocContent(content),
    editorProps: { attributes: { class: 'zinx-doc-body focus:outline-none' } },
    onUpdate: ({ editor: instance }) => {
      if (!canWriteRef.current) return
      const json = JSON.stringify(instance.getJSON())
      if (json === lastSaved.current) return
      // Don't materialise a document out of an editor that opened blank for reasons the
      // user didn't cause. Once anything real is typed, `isEmptyDocContent` is false and
      // this stops applying.
      if (!loadedContent.current && isEmptyDocContent(json)) return
      persist(json)
    }
  })

  // ── Gutter handles (`+` / drag) ─────────────────────────────────────────
  //
  // The hovered position and the measured line height live in REFS and are written straight
  // to the DOM, never React state. `onNodeChange` fires as the pointer crosses blocks, so
  // putting it in state re-renders this whole component — editor, bubble menu, TOC — dozens
  // of times a second. (The suggestion menu is immune by construction: it lives outside this
  // tree entirely. See `doc-suggestion-render.tsx`.)
  const handlePosRef = useRef<number | null>(null)
  const handleBoxRef = useRef<HTMLDivElement>(null)

  const handleNodeChange = useCallback(
    ({ pos, editor: instance }: { pos: number; editor: Editor }) => {
      handlePosRef.current = pos >= 0 ? pos : null

      // Centre the icons on the block's FIRST LINE. The handle is placed flush with the
      // block's top, and a fixed offset can't work when a heading, a paragraph and a list
      // item all have different line boxes — and the UI-scale setting moves all of them.
      const box = handleBoxRef.current
      if (!box) return
      const dom = pos >= 0 ? instance.view.nodeDOM(pos) : null
      const measured =
        dom instanceof HTMLElement ? parseFloat(window.getComputedStyle(dom).lineHeight) : NaN
      box.style.height = Number.isFinite(measured) ? `${measured}px` : ''
    },
    []
  )

  const insertBlockBelow = useCallback(() => {
    const pos = handlePosRef.current
    if (!editor || pos === null) return

    // With `nested` handles the hovered node can be a LIST ITEM (or any block inside a
    // blockquote, column or toggle). Inserting a paragraph directly after a list item is
    // invalid against the schema — a bulletList only accepts listItem children — so
    // ProseMirror would quietly drop it and the `+` would appear to do nothing. Walk up to
    // the outermost block and insert after that, which is always valid.
    const resolved = editor.state.doc.resolve(pos)
    const targetPos = resolved.depth > 0 ? resolved.before(1) : pos

    const node = editor.state.doc.nodeAt(targetPos)
    if (!node) return
    const end = targetPos + node.nodeSize
    editor
      .chain()
      .focus()
      .insertContentAt(end, { type: 'paragraph' })
      .setTextSelection(end + 1)
      // Typing the trigger rather than opening a menu directly — the suggestion plugin owns
      // the menu, and this is what it listens for.
      .insertContent('/')
      .run()
  }, [editor])

  const patchMeta = useCallback(
    (patch: DocMetaPatch) => {
      if (!canWriteRef.current) return
      persistMeta(patch)
    },
    [persistMeta]
  )

  const uploadCover = useCallback(
    async (file: File): Promise<void> => {
      if (!onUploadCover) return
      const url = await track(onUploadCover(file))
      setCover(String(url))
      setCoverY(DEFAULT_COVER_Y)
    },
    [onUploadCover, track]
  )

  const showAddRow = canWrite && (!icon || !cover)

  return (
    // `@container` — the doc's own column is what the layout keys on, not the viewport: the
    // sidebar and the members panel both change how much room it has.
    <div className="@container relative flex min-h-0 flex-1">
      <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
        {cover ? (
          <DocCover
            cover={cover}
            coverY={coverY}
            canEdit={canWrite}
            onCoverYChange={(y) => {
              setCoverY(y)
              patchMeta({ coverY: y })
            }}
            onChange={() => setCoverPickerOpen(true)}
            onRemove={() => {
              setCover('')
              patchMeta({ cover: null })
            }}
          />
        ) : null}

        <div className={cn('zinx-doc mx-auto max-w-3xl pb-24', !cover && 'pt-12')}>
          <div
            className={cn(
              'zinx-doc-head group relative mb-4',
              // Pull the icon up so it straddles the cover's bottom edge — but only when
              // there IS an icon, or the title rides up onto the cover.
              cover && icon && '-mt-12'
            )}
          >
            {icon ? (
              canWrite ? (
                <Popover open={iconPickerOpen} onOpenChange={setIconPickerOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        title="Change icon"
                        className="mb-2 size-20 rounded-xl p-0 text-6xl leading-none hover:bg-accent"
                      />
                    }
                  >
                    {icon}
                  </PopoverTrigger>
                  <PopoverContent className="w-fit p-0">
                    <EmojiPickerPanel
                      onSelect={(emoji) => {
                        setIcon(emoji)
                        patchMeta({ icon: emoji })
                        setIconPickerOpen(false)
                      }}
                      onRemove={() => {
                        setIcon('')
                        patchMeta({ icon: null })
                        setIconPickerOpen(false)
                      }}
                    />
                  </PopoverContent>
                </Popover>
              ) : (
                <div className="mb-2 flex size-20 items-center justify-center text-6xl leading-none">
                  {icon}
                </div>
              )
            ) : null}

            {showAddRow ? (
              // Fixed height, so hover never shifts the layout.
              <div className="mb-1 flex h-7 items-center gap-1 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
                {!icon ? (
                  <Popover open={iconPickerOpen} onOpenChange={setIconPickerOpen}>
                    <PopoverTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-auto gap-1.5 px-1.5 py-1 text-sm font-normal text-muted-foreground hover:text-foreground"
                        />
                      }
                    >
                      <Smiley className="size-4" /> Add icon
                    </PopoverTrigger>
                    <PopoverContent className="w-fit p-0">
                      <EmojiPickerPanel
                        onSelect={(emoji) => {
                          setIcon(emoji)
                          patchMeta({ icon: emoji })
                          setIconPickerOpen(false)
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                ) : null}
                {!cover ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setCoverPickerOpen(true)}
                    className="h-auto gap-1.5 px-1.5 py-1 text-sm font-normal text-muted-foreground hover:text-foreground"
                  >
                    <ImageSquare className="size-4" /> Add cover
                  </Button>
                ) : null}
              </div>
            ) : null}

            <input
              value={title}
              readOnly={!canWrite}
              onChange={(event) => {
                setTitle(event.target.value)
                patchMeta({ title: event.target.value })
              }}
              onKeyDown={(event) => {
                // Enter drops into the body, like Notion.
                if (event.key === 'Enter') {
                  event.preventDefault()
                  editor?.chain().focus().run()
                }
              }}
              placeholder="Untitled"
              aria-label="Page title"
              className="w-full bg-transparent text-4xl font-bold tracking-tight text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>

          {/* Below the title, not above it: with a cover, anything here would sit between
              the cover and the icon — which is pulled up by -mt-12 and lands on top of it. */}
          <div className="zinx-doc-narrow-note" role="note">
            <ArrowsOutSimple className="size-4 shrink-0" />
            <span>
              Some editing tools are hidden here — open on a wider screen for the full editor.
            </span>
          </div>

          {editor ? (
            <>
              {canWrite ? (
                <>
                  {/* Notion's gutter: `+` adds a block below, the grip drags the hovered
                      one. `nested` so list items and blockquote children get one too. */}
                  <DragHandle editor={editor} nested onNodeChange={handleNodeChange}>
                    <div ref={handleBoxRef} className="zinx-block-handles">
                      <button
                        type="button"
                        aria-label="Insert block below"
                        title="Insert block below"
                        className="zinx-block-add"
                        onClick={insertBlockBelow}
                      >
                        <Plus weight="bold" />
                      </button>
                      <div
                        className="zinx-drag-handle"
                        aria-label="Drag to move"
                        role="button"
                        tabIndex={-1}
                      />
                    </div>
                  </DragHandle>
                  <DocBubbleMenu editor={editor} />
                </>
              ) : null}
              {/* `relative` is load-bearing: the bubble menu is appended here and positioned
                  absolutely, so this has to be its offset parent — otherwise it anchors to
                  an ancestor OUTSIDE the scroller and drifts away from the text as you
                  scroll. */}
              <EditorContent editor={editor} className="relative" />
            </>
          ) : null}
        </div>
      </div>

      {/* A SIBLING of the scroller — a child would scroll away with the text. */}
      {editor ? <DocToc editor={editor} scrollRef={scrollRef} /> : null}

      <SaveStatus state={state} error={error} />

      {/* The suggestion popup is NOT rendered here — it mounts itself into document.body
          through a ReactRenderer owned by the suggestion plugin, so this component
          re-rendering can never disturb an open menu. */}

      {emojiAnchor && editor ? (
        <CaretEmojiPicker
          rect={emojiAnchor}
          onClose={() => setEmojiAnchor(null)}
          onSelect={(emoji) => {
            editor.chain().focus().insertContent(emoji).run()
            setEmojiAnchor(null)
          }}
        />
      ) : null}

      {canWrite ? (
        <DocCoverPicker
          open={coverPickerOpen}
          onOpenChange={setCoverPickerOpen}
          allowUnsplash={allowUnsplash}
          onSelect={(value) => {
            setCover(value)
            setCoverY(DEFAULT_COVER_Y)
            patchMeta({ cover: value, coverY: DEFAULT_COVER_Y })
          }}
          onUpload={
            onUploadCover
              ? async (file) => {
                  try {
                    await uploadCover(file)
                  } catch (caught) {
                    toast.error(errorMessage(caught, "Couldn't upload that image"))
                  }
                }
              : undefined
          }
        />
      ) : null}

      {/* `/bookmark`. The host owns this dialog because Electron refuses `window.prompt`. */}
      <Dialog open={bookmarkOpen} onOpenChange={setBookmarkOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add a bookmark</DialogTitle>
          </DialogHeader>
          <form
            id="doc-bookmark-form"
            onSubmit={(event) => {
              event.preventDefault()
              const url = bookmarkUrl.trim()
              if (!url || !editor) return
              editor
                .chain()
                .focus()
                .insertContent({
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }
                  ]
                })
                .run()
              setBookmarkOpen(false)
            }}
          >
            <Input
              autoFocus
              value={bookmarkUrl}
              onChange={(event) => setBookmarkUrl(event.target.value)}
              placeholder="https://…"
            />
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setBookmarkOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="doc-bookmark-form" disabled={!bookmarkUrl.trim()}>
              Add link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * The emoji picker for `/emoji`, anchored to the caret.
 *
 * Portaled and fixed-positioned for the same reason as the suggestion menu: the editor sits
 * inside an `overflow-y: auto` scroller that would clip it.
 */
function CaretEmojiPicker({
  rect,
  onSelect,
  onClose
}: {
  rect: DOMRect
  onSelect: (emoji: string) => void
  onClose: () => void
}): React.ReactPortal {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const placeBelow = window.innerHeight - rect.bottom > 460

  return createPortal(
    <>
      {/* A click-away layer — cheaper and more predictable here than wiring a Popover to a
          virtual anchor. */}
      <div className="fixed inset-0 z-40" onMouseDown={onClose} />
      <div
        className="z-50 overflow-hidden rounded-lg border bg-popover shadow-xl"
        style={{
          position: 'fixed',
          left: Math.min(rect.left, window.innerWidth - 380),
          ...(placeBelow ? { top: rect.bottom + 8 } : { bottom: window.innerHeight - rect.top + 8 })
        }}
      >
        <EmojiPickerPanel onSelect={onSelect} />
      </div>
    </>,
    document.body
  )
}

export default DocEditor
