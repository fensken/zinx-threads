import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { TextSelection } from '@tiptap/pm/state'
import {
  CaretDown,
  Check,
  Code,
  LinkBreak,
  LinkSimple,
  Palette,
  TextAlignCenter,
  TextAlignLeft,
  TextAlignRight,
  TextB,
  TextItalic,
  TextStrikethrough,
  TextSubscript,
  TextSuperscript,
  TextUnderline
} from '@phosphor-icons/react'

import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Separator } from '@renderer/components/ui/separator'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'

/**
 * The floating formatting bar you get when you select text.
 *
 * It reads `editor.isActive(...)` directly on every render rather than caching: `BubbleMenu`
 * re-renders on every selection change, so a derived cache would only ever be a chance to
 * go stale.
 *
 * The swatches below are **content colours, not theme colours** — the same exemption the
 * kanban labels and the Excalidraw palette take. A reader who paints a word red means red,
 * and it must survive a theme swap; mapping them onto semantic tokens would make "red" mean
 * whatever `--destructive` happens to be. The backgrounds carry a `26` alpha suffix so they
 * stay legible against both the light and dark surface.
 */

const TEXT_COLORS: { label: string; value: string | null }[] = [
  { label: 'Default', value: null },
  { label: 'Grey', value: '#8a8f98' },
  { label: 'Brown', value: '#a1734c' },
  { label: 'Orange', value: '#d9730d' },
  { label: 'Yellow', value: '#cb912f' },
  { label: 'Green', value: '#448361' },
  { label: 'Blue', value: '#337ea9' },
  { label: 'Purple', value: '#9065b0' },
  { label: 'Pink', value: '#c14c8a' },
  { label: 'Red', value: '#d44c47' }
]

const BACKGROUND_COLORS: { label: string; value: string | null }[] = [
  { label: 'Default', value: null },
  { label: 'Grey', value: '#8a8f9826' },
  { label: 'Brown', value: '#a1734c26' },
  { label: 'Orange', value: '#d9730d26' },
  { label: 'Yellow', value: '#cb912f26' },
  { label: 'Green', value: '#44836126' },
  { label: 'Blue', value: '#337ea926' },
  { label: 'Purple', value: '#9065b026' },
  { label: 'Pink', value: '#c14c8a26' },
  { label: 'Red', value: '#d44c4726' }
]

interface BlockOption {
  label: string
  isActive: (editor: Editor) => boolean
  apply: (editor: Editor) => void
}

const BLOCK_OPTIONS: BlockOption[] = [
  {
    label: 'Text',
    isActive: (editor) => editor.isActive('paragraph'),
    apply: (editor) => editor.chain().focus().setParagraph().run()
  },
  {
    label: 'Heading 1',
    isActive: (editor) => editor.isActive('heading', { level: 1 }),
    apply: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run()
  },
  {
    label: 'Heading 2',
    isActive: (editor) => editor.isActive('heading', { level: 2 }),
    apply: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run()
  },
  {
    label: 'Heading 3',
    isActive: (editor) => editor.isActive('heading', { level: 3 }),
    apply: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run()
  },
  {
    label: 'Bulleted list',
    isActive: (editor) => editor.isActive('bulletList'),
    apply: (editor) => editor.chain().focus().toggleBulletList().run()
  },
  {
    label: 'Numbered list',
    isActive: (editor) => editor.isActive('orderedList'),
    apply: (editor) => editor.chain().focus().toggleOrderedList().run()
  },
  {
    label: 'To-do list',
    isActive: (editor) => editor.isActive('taskList'),
    apply: (editor) => editor.chain().focus().toggleTaskList().run()
  },
  {
    label: 'Quote',
    isActive: (editor) => editor.isActive('blockquote'),
    apply: (editor) => editor.chain().focus().toggleBlockquote().run()
  },
  {
    label: 'Code block',
    isActive: (editor) => editor.isActive('codeBlock'),
    apply: (editor) => editor.chain().focus().toggleCodeBlock().run()
  }
]

function ToolbarButton({
  label,
  active,
  onClick,
  children
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            // onMouseDown, not onClick: a click blurs the editor first, collapsing the very
            // selection the command is about to act on.
            onMouseDown={(event) => {
              event.preventDefault()
              onClick()
            }}
            className={cn('size-7', active && 'bg-accent text-accent-foreground')}
            aria-label={label}
            aria-pressed={active}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function DocBubbleMenu({ editor }: { editor: Editor }): React.JSX.Element {
  const [linkDraft, setLinkDraft] = useState('')

  const activeBlock = BLOCK_OPTIONS.find((option) => option.isActive(editor)) ?? BLOCK_OPTIONS[0]

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: instance, from, to }) => {
        if (!instance.isEditable) return false
        if (from === to || instance.state.selection.empty) return false
        // A whole node is selected (image, embed, attachment, whiteboard) — those carry
        // their own inline controls, and none of these commands apply to them.
        if (!(instance.state.selection instanceof TextSelection)) return false
        // Code is literal; formatting it would just insert markup as text.
        if (instance.isActive('codeBlock')) return false
        return true
      }}
      options={{ placement: 'top', offset: 8 }}
      className="zinx-bubble-menu"
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs font-normal"
            />
          }
        >
          {activeBlock.label}
          <CaretDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-40">
          {BLOCK_OPTIONS.map((option) => (
            <DropdownMenuItem key={option.label} onClick={() => option.apply(editor)}>
              {option.label}
              {option.isActive(editor) ? <Check className="ml-auto size-3.5" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="h-5" />

      <ToolbarButton
        label="Bold"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <TextB className="size-4" weight="bold" />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <TextItalic className="size-4" weight="bold" />
      </ToolbarButton>
      <ToolbarButton
        label="Underline"
        active={editor.isActive('underline')}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <TextUnderline className="size-4" weight="bold" />
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        active={editor.isActive('strike')}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <TextStrikethrough className="size-4" weight="bold" />
      </ToolbarButton>
      <ToolbarButton
        label="Inline code"
        active={editor.isActive('code')}
        onClick={() => editor.chain().focus().toggleCode().run()}
      >
        <Code className="size-4" weight="bold" />
      </ToolbarButton>

      <Separator orientation="vertical" className="h-5" />

      {/* Colour */}
      <Popover>
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-7"
                    aria-label="Colour"
                  />
                }
              />
            }
          >
            <Palette className="size-4" weight="duotone" />
          </TooltipTrigger>
          <TooltipContent>Colour</TooltipContent>
        </Tooltip>
        <PopoverContent className="w-52 p-2" align="start">
          <p className="mb-1 px-1 text-xs text-muted-foreground">Text</p>
          <div className="mb-2 grid grid-cols-5 gap-1">
            {TEXT_COLORS.map((colour) => (
              <button
                key={colour.label}
                type="button"
                title={colour.label}
                aria-label={`Text ${colour.label}`}
                onClick={() =>
                  colour.value
                    ? editor.chain().focus().setColor(colour.value).run()
                    : editor.chain().focus().unsetColor().run()
                }
                className="flex size-8 items-center justify-center rounded-md border text-sm font-semibold hover:ring-2 hover:ring-ring"
                style={{ color: colour.value ?? undefined }}
              >
                A
              </button>
            ))}
          </div>
          <p className="mb-1 px-1 text-xs text-muted-foreground">Background</p>
          <div className="grid grid-cols-5 gap-1">
            {BACKGROUND_COLORS.map((colour) => (
              <button
                key={colour.label}
                type="button"
                title={colour.label}
                aria-label={`Background ${colour.label}`}
                onClick={() =>
                  colour.value
                    ? editor.chain().focus().setBackgroundColor(colour.value).run()
                    : editor.chain().focus().unsetBackgroundColor().run()
                }
                className="flex size-8 items-center justify-center rounded-md border text-sm font-semibold hover:ring-2 hover:ring-ring"
                style={{ backgroundColor: colour.value ?? undefined }}
              >
                A
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Link */}
      <Popover
        onOpenChange={(open) => {
          if (open) setLinkDraft(String(editor.getAttributes('link').href ?? ''))
        }}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className={cn('size-7', editor.isActive('link') && 'bg-accent')}
                    aria-label="Link"
                  />
                }
              />
            }
          >
            <LinkSimple className="size-4" weight="bold" />
          </TooltipTrigger>
          <TooltipContent>Link</TooltipContent>
        </Tooltip>
        <PopoverContent className="w-72 p-2" align="start">
          <form
            className="flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault()
              const href = linkDraft.trim()
              if (!href) {
                editor.chain().focus().unsetLink().run()
                return
              }
              editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
            }}
          >
            <Input
              value={linkDraft}
              onChange={(event) => setLinkDraft(event.target.value)}
              placeholder="https://…"
              className="h-8 text-sm"
            />
            <Button type="submit" size="sm">
              Apply
            </Button>
            {editor.isActive('link') ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove link"
                onClick={() => editor.chain().focus().unsetLink().run()}
              >
                <LinkBreak className="size-4" />
              </Button>
            ) : null}
          </form>
        </PopoverContent>
      </Popover>

      <Separator orientation="vertical" className="h-5" />

      <ToolbarButton
        label="Align left"
        active={editor.isActive({ textAlign: 'left' })}
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
      >
        <TextAlignLeft className="size-4" weight="bold" />
      </ToolbarButton>
      <ToolbarButton
        label="Align centre"
        active={editor.isActive({ textAlign: 'center' })}
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
      >
        <TextAlignCenter className="size-4" weight="bold" />
      </ToolbarButton>
      <ToolbarButton
        label="Align right"
        active={editor.isActive({ textAlign: 'right' })}
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
      >
        <TextAlignRight className="size-4" weight="bold" />
      </ToolbarButton>

      <Separator orientation="vertical" className="h-5" />

      <ToolbarButton
        label="Superscript"
        active={editor.isActive('superscript')}
        onClick={() => editor.chain().focus().toggleSuperscript().run()}
      >
        <TextSuperscript className="size-4" weight="bold" />
      </ToolbarButton>
      <ToolbarButton
        label="Subscript"
        active={editor.isActive('subscript')}
        onClick={() => editor.chain().focus().toggleSubscript().run()}
      >
        <TextSubscript className="size-4" weight="bold" />
      </ToolbarButton>
    </BubbleMenu>
  )
}
