import '@blocknote/ariakit/style.css'
import '@renderer/components/page/page-editor.css'

import { useCallback, useRef, useState, useSyncExternalStore } from 'react'
import { ImageSquare, Lightbulb, Smiley } from '@phosphor-icons/react'
import { BlockNoteView } from '@blocknote/ariakit'
import {
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote
} from '@blocknote/react'
import { flip, offset, shift } from '@floating-ui/react'
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

// BlockNote prints a group header for each *contiguous* run of items sharing a
// `group`, so items must be ordered by group or a group's header repeats.
const SLASH_GROUP_ORDER = ['Headings', 'Subheadings', 'Basic blocks', 'Advanced', 'Media', 'Others']

function groupRank(group?: string): number {
  const index = SLASH_GROUP_ORDER.indexOf(group ?? '')
  return index === -1 ? SLASH_GROUP_ORDER.length : index
}

function slashItems(editor: PageEditorInstance, query: string): SlashItem[] {
  // Stable sort by group so each group renders exactly one header (and our custom
  // callout merges into "Basic blocks" instead of forming a second run).
  const items = [...getDefaultReactSlashMenuItems(editor), calloutSlashItem(editor)].sort(
    (a, b) => groupRank(a.group) - groupRank(b.group)
  )
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
  allowNetworkCovers = true
}: {
  doc: PageDoc
  /** The whole document, on every edit. Debounce upstream. */
  onContentChange?: (content: string) => void
  onMetaChange?: (patch: PageMetaPatch) => void
  /** Upload a picked cover image → the resolved cover URL. Present only on the
   *  real (Convex) path; without it the picker's Upload tab is hidden. */
  onCoverUpload?: (file: File) => Promise<string>
  /** Cover sources needing Convex/network (Unsplash). Off on the offline editor. */
  allowNetworkCovers?: boolean
}): React.JSX.Element {
  const isDark = useIsDark()
  const editor = useCreateBlockNote({
    schema,
    initialContent: doc.blocks.length ? doc.blocks : undefined
  })

  // Chrome is local state seeded from `doc`; the caller persists it via
  // `onMetaChange`. Not re-synced from `doc` — that would fight the user's typing.
  const [cover, setCover] = useState<string | undefined>(doc.cover)
  const [coverY, setCoverY] = useState(doc.coverY ?? 50)
  const [icon, setIcon] = useState(doc.icon ?? '')
  const [title, setTitle] = useState(doc.title)
  const [coverPickerOpen, setCoverPickerOpen] = useState(false)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  /** The scroll container — the table of contents reads it and scrolls it. */
  const scrollRef = useRef<HTMLDivElement>(null)

  const patchMeta = (patch: PageMetaPatch): void => onMetaChange?.(patch)

  // Stable identity: `BlockNoteView` re-subscribes its change listener whenever
  // this prop changes, and our own save-state updates re-render this component.
  const handleChange = useCallback(() => {
    onContentChange?.(JSON.stringify(editor.document))
  }, [editor, onContentChange])

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
          {/* `mb-4` is the breathing room between the title and the first block. Flush
            reads as a caption of the title; much more and the page looks broken. */}
          <div className={cn('zinx-page-head group relative mb-4', cover && '-mt-12')}>
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
              getItems={async (query) => slashItems(editor, query)}
              // BlockNote's default middleware uses `size` to shrink the menu to the
              // space below the cursor — which also stops `flip` from ever firing, so
              // near the page bottom it stayed clipped instead of opening upward.
              // Replace it with offset+flip+shift and give the menu a fixed,
              // scrollable height in CSS (.bn-suggestion-menu), positioned against the
              // viewport (`fixed`) so it's never clipped by the scroll container.
              floatingUIOptions={{
                useFloatingOptions: {
                  strategy: 'fixed',
                  middleware: [offset(8), flip({ padding: 12 }), shift({ padding: 12 })]
                }
              }}
            />
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
