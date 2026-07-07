import '@blocknote/ariakit/style.css'
import './page-editor.css'

import { useMemo, useState, useSyncExternalStore } from 'react'
import { ChatCircle, ImageSquare, Lightbulb, Smiley } from '@phosphor-icons/react'
import {
  BlockNoteSchema,
  createCodeBlockSpec,
  defaultBlockSpecs,
  type BlockNoteEditor
} from '@blocknote/core'
import { codeBlockOptions } from '@blocknote/code-block'
import { BlockNoteView } from '@blocknote/ariakit'
import {
  createReactBlockSpec,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote
} from '@blocknote/react'
import { flip, offset, shift } from '@floating-ui/react'
import { useThemeStore } from '@renderer/store/theme-store'
import type { Page } from '@renderer/data/workspaces'
import { cn } from '@renderer/lib/utils'
import { PageCover } from './page-cover'
import { CoverPicker } from './cover-picker'
import { EmojiPicker } from './emoji-picker'
import { randomEmoji } from './emoji-data'

// --- Custom block: Notion-style callout (emoji + inline content). Proves the
// custom-block path; everything else maps onto BlockNote's built-in blocks. ---
const CalloutBlock = createReactBlockSpec(
  {
    type: 'callout',
    propSchema: { emoji: { default: '💡' } },
    content: 'inline'
  },
  {
    render: ({ block, contentRef }): React.JSX.Element => (
      <div className="zinx-callout">
        <span className="zinx-callout-emoji" contentEditable={false} suppressContentEditableWarning>
          {block.props.emoji}
        </span>
        <div className="zinx-callout-body" ref={contentRef} />
      </div>
    )
  }
)

const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    // Replace the default (unhighlighted) code block with a Shiki-highlighted one.
    // @blocknote/code-block uses Shiki's JS engine + precompiled grammars (no WASM),
    // so it works under our `script-src 'self'` CSP.
    codeBlock: createCodeBlockSpec(codeBlockOptions),
    callout: CalloutBlock()
  }
})

type Editor = BlockNoteEditor<
  typeof schema.blockSchema,
  typeof schema.inlineContentSchema,
  typeof schema.styleSchema
>
type SlashItem = ReturnType<typeof getDefaultReactSlashMenuItems>[number]

/** Map the mock `PageBlock[]` onto BlockNote's block model (→ Convex later). */
function pageToBlocks(page: Page): (typeof schema.PartialBlock)[] {
  return page.blocks.map((block): typeof schema.PartialBlock => {
    switch (block.type) {
      case 'heading':
        return { type: 'heading', props: { level: block.level }, content: block.text }
      case 'paragraph':
        return { type: 'paragraph', content: block.text }
      case 'bullet':
        return { type: 'bulletListItem', content: block.text }
      case 'numbered':
        return { type: 'numberedListItem', content: block.text }
      case 'todo':
        return { type: 'checkListItem', props: { checked: block.checked }, content: block.text }
      case 'quote':
        return { type: 'quote', content: block.text }
      case 'callout':
        return { type: 'callout', props: { emoji: block.emoji }, content: block.text }
      case 'code':
        return { type: 'codeBlock', content: block.text }
      case 'divider':
        return { type: 'divider' }
    }
  })
}

/** Slash-menu entry that inserts the custom callout block. */
function calloutSlashItem(editor: Editor): SlashItem {
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

function slashItems(editor: Editor, query: string): SlashItem[] {
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

export function PageEditor({ page }: { page: Page }): React.JSX.Element {
  const isDark = useIsDark()
  const initialContent = useMemo(() => pageToBlocks(page), [page])
  const editor = useCreateBlockNote({ schema, initialContent })

  // Page chrome is local state (mock) — swap onto the page getter → Convex later.
  const [cover, setCover] = useState<string | undefined>(page.cover)
  const [coverY, setCoverY] = useState(50)
  const [icon, setIcon] = useState(page.icon)
  const [title, setTitle] = useState(page.title)
  const [coverPickerOpen, setCoverPickerOpen] = useState(false)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)

  return (
    <div className="relative flex-1 overflow-y-auto">
      {cover ? (
        <PageCover
          cover={cover}
          coverY={coverY}
          onCoverYChange={setCoverY}
          onChange={() => setCoverPickerOpen(true)}
          onRemove={() => setCover(undefined)}
        />
      ) : null}

      <div className={cn('zinx-editor mx-auto max-w-3xl pb-24', cover ? '' : 'pt-12')}>
        <div className={cn('zinx-page-head group relative', cover && '-mt-12')}>
          {icon ? (
            <button
              type="button"
              title="Change icon"
              onClick={() => setIconPickerOpen(true)}
              className="mb-1 flex size-20 items-center justify-center rounded-xl text-6xl leading-none transition-colors hover:bg-accent"
            >
              {icon}
            </button>
          ) : null}

          {/* Notion-style affordances above the title — hover on desktop, always
              visible below lg (touch / narrow windows have no hover). */}
          <div className="mb-1 flex h-7 items-center gap-1 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
            {!icon ? (
              <HeadButton
                icon={<Smiley className="size-4" />}
                label="Add icon"
                onClick={() => setIcon(randomEmoji())}
              />
            ) : null}
            {!cover ? (
              <HeadButton
                icon={<ImageSquare className="size-4" />}
                label="Add cover"
                onClick={() => setCoverPickerOpen(true)}
              />
            ) : null}
            <HeadButton
              icon={<ChatCircle className="size-4" />}
              label="Add comment"
              onClick={() => {}}
            />
          </div>

          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Untitled"
            className="w-full bg-transparent text-4xl font-bold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40"
          />
          {page.subtitle ? <p className="mt-2 text-muted-foreground">{page.subtitle}</p> : null}
        </div>

        <BlockNoteView editor={editor} theme={isDark ? 'dark' : 'light'} slashMenu={false}>
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

      {coverPickerOpen ? (
        <CoverPicker
          onSelect={(value) => {
            setCover(value)
            setCoverY(50)
            setCoverPickerOpen(false)
          }}
          onClose={() => setCoverPickerOpen(false)}
        />
      ) : null}

      {iconPickerOpen ? (
        <EmojiPicker
          onSelect={(value) => setIcon(value)}
          onRemove={() => setIcon('')}
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
