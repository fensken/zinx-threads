import '@blocknote/ariakit/style.css'
import '@renderer/components/page/page-editor.css'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowsOutSimple,
  Gif,
  ImageSquare,
  Lightbulb,
  Smiley,
  VideoCamera
} from '@phosphor-icons/react'
import { filterSuggestionItems } from '@blocknote/core'
import { BlockNoteView } from '@blocknote/ariakit'
import {
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote
} from '@blocknote/react'
import { flip, offset, shift } from '@floating-ui/react'
import { useWorkspaceDirectory } from '@renderer/components/chat/workspace-directory-context'
import { GifPicker, type PickedMediaKind } from '@renderer/components/pickers/gif-picker'
import { PageSuggestionMenu } from '@renderer/components/page/page-mentions'
import {
  channelSuggestionItem,
  memberSuggestionItem,
  roleSuggestionItems,
  type MentionInsert,
  type PageSuggestionItem
} from '@renderer/components/page/page-mention-items'
import { useThemeStore } from '@renderer/store/theme-store'
import { cn } from '@renderer/lib/utils'
import { PageCover } from '@renderer/components/page/page-cover'
import { CoverPicker } from '@renderer/components/page/cover-picker'
import { EmojiPicker } from '@renderer/components/pickers/emoji-picker'
import { PageToc } from '@renderer/components/page/page-toc'
import {
  schema,
  type PageDoc,
  type PageEditorInstance
} from '@renderer/components/page/page-schema'

type SlashItem = ReturnType<typeof getDefaultReactSlashMenuItems>[number]

/** `getItems` shape for the `@`/`#` menus. Passed as `SuggestionMenuController`'s explicit
 *  type argument so it infers our `PageSuggestionItem` (and thus accepts the custom menu
 *  component) instead of defaulting to BlockNote's `DefaultReactSuggestionItem`. */
type MentionGetItems = (query: string) => Promise<PageSuggestionItem[]>

/** Positioning for ALL suggestion menus (`/`, `@`, `#`). Replaces BlockNote's default `size`
 *  middleware (which shrinks the menu to the space below the cursor and so never flips) with
 *  offset+flip+shift, `strategy: 'fixed'` — so every menu **flips upward near the bottom** and
 *  **shifts into view near an edge** instead of being clipped, which matters most on a small
 *  screen. The menu's own scroll height is capped in CSS (`.bn-suggestion-menu`). */
const MENU_FLOATING = {
  useFloatingOptions: {
    strategy: 'fixed' as const,
    middleware: [offset(8), flip({ padding: 12 }), shift({ padding: 12 })]
  }
}

/** Chrome edits, as a partial patch. `null` clears the icon/cover. */
export interface PageMetaPatch {
  title?: string
  icon?: string | null
  cover?: string | null
  coverY?: number
}

/** Slash-menu entry that inserts the custom callout block. */
function calloutSlashItem(editor: PageEditorInstance): SlashItem {
  return {
    title: 'Callout',
    subtext: 'Highlighted note with an emoji',
    aliases: ['callout', 'note', 'info', 'tip', 'box'],
    group: 'Basic blocks',
    icon: <Lightbulb size={18} />,
    onItemClick: () => {
      const { block } = editor.getTextCursorPosition()
      const empty =
        block.type === 'paragraph' && Array.isArray(block.content) && block.content.length === 0
      if (empty) editor.updateBlock(block, { type: 'callout' })
      else editor.insertBlocks([{ type: 'callout' }], block, 'after')
    }
  }
}

/** Slash-menu entry that inserts the custom video-embed block (YouTube / Vimeo). Sits in
 *  the Media group beside the native image/video/audio items — the native `video` block is
 *  for uploaded FILES; this is for embeddable LINKS the `<video>` element can't play. */
function embedSlashItem(editor: PageEditorInstance): SlashItem {
  return {
    title: 'Video embed',
    subtext: 'Embed a YouTube or Vimeo video',
    aliases: ['embed', 'youtube', 'vimeo', 'video link', 'iframe'],
    group: 'Media',
    icon: <VideoCamera size={18} />,
    onItemClick: () => {
      const { block } = editor.getTextCursorPosition()
      const empty =
        block.type === 'paragraph' && Array.isArray(block.content) && block.content.length === 0
      if (empty) editor.updateBlock(block, { type: 'embed' })
      else editor.insertBlocks([{ type: 'embed' }], block, 'after')
    }
  }
}

/** Slash-menu entry that opens the KLIPY GIF / sticker picker (online only). Sits in the
 *  Media group beside image/video/embed; on pick it inserts an `image` block with the URL.
 *  The picker needs the `gifs.search` Convex action, so it's only added when `openGif` is
 *  supplied (the online page — see `PageEditor`). */
function gifSlashItem(openGif: () => void): SlashItem {
  return {
    title: 'GIF & sticker',
    subtext: 'Add a GIF or sticker from KLIPY',
    aliases: ['gif', 'sticker', 'klipy', 'giphy', 'meme'],
    group: 'Media',
    icon: <Gif size={18} />,
    onItemClick: openGif
  }
}

// BlockNote prints a group header for each *contiguous* run of items sharing a
// `group`, so items must be ordered by group or a group's header repeats.
const SLASH_GROUP_ORDER = ['Headings', 'Subheadings', 'Basic blocks', 'Advanced', 'Media', 'Others']

function groupRank(group?: string): number {
  const index = SLASH_GROUP_ORDER.indexOf(group ?? '')
  return index === -1 ? SLASH_GROUP_ORDER.length : index
}

function slashItems(editor: PageEditorInstance, query: string, openGif?: () => void): SlashItem[] {
  // Stable sort by group so each group renders exactly one header (and our custom
  // callout merges into "Basic blocks" instead of forming a second run).
  const items = [
    ...getDefaultReactSlashMenuItems(editor),
    calloutSlashItem(editor),
    embedSlashItem(editor),
    ...(openGif ? [gifSlashItem(openGif)] : [])
  ].sort((a, b) => groupRank(a.group) - groupRank(b.group))
  if (!query) return items
  const q = query.toLowerCase()
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      (item.aliases ?? []).some((alias) => alias.toLowerCase().includes(q))
  )
}

const DARK_QUERY = '(prefers-color-scheme: dark)'

function subscribePrefersDark(onChange: () => void): () => void {
  const media = window.matchMedia(DARK_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

/** BlockNote renders its own light/dark palette; keep it in sync with our theme.
 *  Derived (no effect): store theme + a subscription to the OS preference. */
function useIsDark(): boolean {
  const theme = useThemeStore((state) => state.theme)
  const prefersDark = useSyncExternalStore(
    subscribePrefersDark,
    () => window.matchMedia(DARK_QUERY).matches
  )
  return theme === 'dark' || (theme === 'system' && prefersDark)
}

/** The Notion-style page: cover + emoji icon + title + a BlockNote document.
 *
 *  Presentational. `doc` seeds it **once** (the caller keys this component per
 *  page); edits flow out through `onContentChange` / `onMetaChange`. Omit the
 *  handlers and it's a local-only scratchpad — that's the mock demo path. */
export function PageEditor({
  doc,
  onContentChange,
  onMetaChange,
  onCoverUpload,
  onUploadFile,
  allowNetworkCovers = true
}: {
  doc: PageDoc
  /** The whole document, on every edit. Debounce upstream. */
  onContentChange?: (content: string) => void
  onMetaChange?: (patch: PageMetaPatch) => void
  /** Upload a picked cover image → the resolved cover URL. Present only on the
   *  real (Convex) path; without it the picker's Upload tab is hidden. */
  onCoverUpload?: (file: File) => Promise<string>
  /** Upload a file dropped/selected in an image / file / audio / video **block** →
   *  its durable URL. Enables BlockNote's "Upload" tab (drag-drop + paste too). Absent →
   *  those blocks only embed by URL. Online resolves via R2; local returns a data URL. */
  onUploadFile?: (file: File) => Promise<string>
  /** Cover sources needing Convex/network (Unsplash). Off on the offline editor. */
  allowNetworkCovers?: boolean
}): React.JSX.Element {
  const isDark = useIsDark()
  // People + channels for the `@`/`#` menus — the SAME directory chat reads. `null` on the
  // offline page (no workspace); the `@`/`#` controllers simply aren't mounted there.
  const directory = useWorkspaceDirectory()

  // The editor is created ONCE (BlockNote owns its doc after mount), so a late-changing
  // `onUploadFile` must not rebuild it — read the current handler through a ref instead.
  // The closure runs at upload time, never during render.
  const uploadRef = useRef(onUploadFile)
  useEffect(() => {
    uploadRef.current = onUploadFile
  }, [onUploadFile])
  const canUpload = onUploadFile !== undefined

  const editor = useCreateBlockNote({
    schema,
    initialContent: doc.blocks.length ? doc.blocks : undefined,
    // BlockNote calls this when a file is uploaded in an image/file/audio/video block; the
    // returned URL is stored in the block. Wired only when a handler is supplied.
    uploadFile: canUpload
      ? async (file: File): Promise<string> => {
          const fn = uploadRef.current
          if (!fn) throw new Error('Uploads are not available here')
          return fn(file)
        }
      : undefined
  })

  // Chrome is local state seeded from `doc`; the caller persists it via
  // `onMetaChange`. Not re-synced from `doc` — that would fight the user's typing.
  const [cover, setCover] = useState<string | undefined>(doc.cover)
  const [coverY, setCoverY] = useState(doc.coverY ?? 50)
  const [icon, setIcon] = useState(doc.icon ?? '')
  const [title, setTitle] = useState(doc.title)
  const [coverPickerOpen, setCoverPickerOpen] = useState(false)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [gifPickerOpen, setGifPickerOpen] = useState(false)
  /** The block the GIF slash command fired from — a picked GIF is inserted relative to it,
   *  captured at open time since the picker steals focus (the caret isn't reliable on pick). */
  const gifTargetRef = useRef<ReturnType<typeof editor.getTextCursorPosition>['block'] | null>(null)
  /** The scroll container — the table of contents reads it and scrolls it. */
  const scrollRef = useRef<HTMLDivElement>(null)

  const patchMeta = (patch: PageMetaPatch): void => onMetaChange?.(patch)

  // Stable identity: `BlockNoteView` re-subscribes its change listener whenever
  // this prop changes, and our own save-state updates re-render this component.
  const handleChange = useCallback(() => {
    onContentChange?.(JSON.stringify(editor.document))
  }, [editor, onContentChange])

  // Insert a `@user` / `#channel` pill + a trailing space (BlockNote has already
  // stripped the "@query" / "#query" the menu matched on).
  const insertMention = useCallback(
    (mention: MentionInsert): void => {
      editor.insertInlineContent([{ type: 'mention', props: mention }, ' '])
    },
    [editor]
  )

  // `/gif` opens the KLIPY picker. Remember which block it fired from now, while the caret
  // is still where the user typed — the picker steals focus, so on pick we can't rely on it.
  const openGifPicker = useCallback((): void => {
    gifTargetRef.current = editor.getTextCursorPosition().block
    setGifPickerOpen(true)
  }, [editor])

  // A picked GIF / sticker is just an external image URL → an `image` block (KLIPY's CDN is
  // allowed by CSP `img-src https:`). Replace the (empty) slash block, else insert after it.
  const insertGif = useCallback(
    (url: string, kind: PickedMediaKind): void => {
      setGifPickerOpen(false)
      const target = gifTargetRef.current
      gifTargetRef.current = null
      if (!target) return
      const isEmptyParagraph =
        target.type === 'paragraph' && Array.isArray(target.content) && target.content.length === 0
      const imageBlock = { type: 'image' as const, props: { url, name: kind } }
      if (isEmptyParagraph) editor.updateBlock(target, imageBlock)
      else editor.insertBlocks([imageBlock], target, 'after')
    },
    [editor]
  )

  return (
    // The wrapper doesn't scroll; the inner column does. An `absolute` child of a
    // scrolling element scrolls away with the content, and the table of contents
    // has to stay put. `@container` lets the TOC hide itself when *this column* is
    // narrow, regardless of how wide the window is.
    <div className="@container relative flex min-h-0 flex-1">
      <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
        {cover ? (
          <PageCover
            cover={cover}
            coverY={coverY}
            onCoverYChange={(next) => {
              setCoverY(next)
              patchMeta({ coverY: next })
            }}
            onChange={() => setCoverPickerOpen(true)}
            onRemove={() => {
              setCover(undefined)
              patchMeta({ cover: null })
            }}
          />
        ) : null}

        <div className={cn('zinx-editor mx-auto max-w-3xl pb-24', cover ? '' : 'pt-12')}>
          {/* Shown only when the editor chrome is hidden (narrow column / small screen — see
              `page-editor.css` 4c). Pure CSS visibility; no JS state. */}
          <div className="zinx-narrow-note" role="note">
            <ArrowsOutSimple className="size-4" />
            <span>
              Some editing tools are hidden here — open on a larger screen for the full editor.
            </span>
          </div>

          {/* `mb-4` is the breathing room between the title and the first block. Flush
            reads as a caption of the title; much more and the page looks broken.
            The `-mt-12` pulls the head up so an ICON straddles the cover's bottom edge
            (Notion-style) — but with no icon it would drag the TITLE up over the cover,
            so it only applies when there's an icon to overlap. */}
          <div className={cn('zinx-page-head group relative mb-4', cover && icon && '-mt-12')}>
            {icon ? (
              <button
                type="button"
                title="Change icon"
                onClick={() => setIconPickerOpen(true)}
                className="mb-2 flex size-20 items-center justify-center rounded-xl text-6xl leading-none transition-colors hover:bg-accent"
              >
                {icon}
              </button>
            ) : null}

            {/* Notion-style affordances above the title — hover on desktop, always
              visible below lg (touch / narrow windows have no hover). Rendered only
              when it has something to offer: once the page has both an icon and a
              cover, an always-present empty row just pads the title away from it.
              While it *is* rendered its height is reserved, so hover never shifts. */}
            {!icon || !cover ? (
              <div className="mb-1 flex h-7 items-center gap-1 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
                {!icon ? (
                  <HeadButton
                    icon={<Smiley className="size-4" />}
                    label="Add icon"
                    onClick={() => setIconPickerOpen(true)}
                  />
                ) : null}
                {!cover ? (
                  <HeadButton
                    icon={<ImageSquare className="size-4" />}
                    label="Add cover"
                    onClick={() => setCoverPickerOpen(true)}
                  />
                ) : null}
              </div>
            ) : null}

            <input
              value={title}
              onChange={(event) => {
                setTitle(event.target.value)
                patchMeta({ title: event.target.value })
              }}
              placeholder="Untitled"
              className="w-full bg-transparent text-4xl font-bold tracking-tight text-foreground outline-none placeholder:text-muted-foreground"
            />
            {doc.subtitle ? <p className="mt-2 text-muted-foreground">{doc.subtitle}</p> : null}
          </div>

          <BlockNoteView
            editor={editor}
            theme={isDark ? 'dark' : 'light'}
            slashMenu={false}
            onChange={onContentChange ? handleChange : undefined}
          >
            <SuggestionMenuController
              triggerCharacter="/"
              // The GIF/sticker item is offered only where KLIPY search works — the online
              // page (same `allowNetworkCovers` gate the Unsplash cover tab uses).
              getItems={async (query) =>
                slashItems(editor, query, allowNetworkCovers ? openGifPicker : undefined)
              }
              floatingUIOptions={MENU_FLOATING}
            />

            {/* `@user` / `#channel` mentions — only when a workspace directory exists (the
                online page). Each inserts a `mention` inline atom, and both render through the
                SAME custom menu the chat composer uses (`PageSuggestionMenu`: avatar / kind icon
                + name + subtext), instead of BlockNote's default icon-less, blue-selection menu.
                BlockNote strips the "@query" / "#query" before the item's click runs. */}
            {directory ? (
              <>
                <SuggestionMenuController<MentionGetItems>
                  triggerCharacter="@"
                  suggestionMenuComponent={PageSuggestionMenu}
                  onItemClick={(item) => item.onItemClick()}
                  getItems={async (query): Promise<PageSuggestionItem[]> =>
                    filterSuggestionItems(
                      [
                        // Members first, then the role groups — Discord's / chat's ordering.
                        ...directory.members.map((member) =>
                          memberSuggestionItem(member, insertMention)
                        ),
                        ...roleSuggestionItems(directory.canModerate, insertMention)
                      ],
                      query
                    )
                  }
                  floatingUIOptions={MENU_FLOATING}
                />
                <SuggestionMenuController<MentionGetItems>
                  triggerCharacter="#"
                  suggestionMenuComponent={PageSuggestionMenu}
                  onItemClick={(item) => item.onItemClick()}
                  getItems={async (query): Promise<PageSuggestionItem[]> =>
                    filterSuggestionItems(
                      directory.channels.map((channel) =>
                        channelSuggestionItem(channel, insertMention)
                      ),
                      query
                    )
                  }
                  floatingUIOptions={MENU_FLOATING}
                />
              </>
            ) : null}
          </BlockNoteView>
        </div>
      </div>

      <PageToc editor={editor} scrollRef={scrollRef} />

      {coverPickerOpen ? (
        <CoverPicker
          onSelect={(value) => {
            setCover(value)
            setCoverY(50)
            setCoverPickerOpen(false)
            patchMeta({ cover: value, coverY: 50 })
          }}
          onUpload={
            onCoverUpload
              ? async (file) => {
                  // The upload persists the cover itself (server-resolved URL);
                  // we only reflect it in local state — no `patchMeta`, which
                  // would treat it as a non-upload cover and delete the object.
                  const url = await onCoverUpload(file)
                  setCover(url)
                  setCoverY(50)
                  setCoverPickerOpen(false)
                }
              : undefined
          }
          allowUnsplash={allowNetworkCovers}
          onClose={() => setCoverPickerOpen(false)}
        />
      ) : null}

      {iconPickerOpen ? (
        <EmojiPicker
          onSelect={(value) => {
            setIcon(value)
            patchMeta({ icon: value })
          }}
          onRemove={() => {
            setIcon('')
            patchMeta({ icon: null })
          }}
          onClose={() => setIconPickerOpen(false)}
        />
      ) : null}

      {/* KLIPY GIF / sticker picker — a centered overlay (no natural anchor after the slash
          menu closes). Portaled to <body> so the `fixed` backdrop escapes any transformed
          ancestor in the shell (the documented fixed-inside-transform trap). */}
      {gifPickerOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
              onClick={() => setGifPickerOpen(false)}
            >
              <div onClick={(event) => event.stopPropagation()}>
                <GifPicker onSelect={insertGif} />
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

function HeadButton({
  icon,
  label,
  onClick
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {icon}
      {label}
    </button>
  )
}
