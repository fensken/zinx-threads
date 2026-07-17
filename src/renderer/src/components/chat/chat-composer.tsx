import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { EditorContent, Extension, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Placeholder } from '@tiptap/extensions'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import {
  BellSlash,
  Code,
  CodeBlock,
  LinkSimple,
  ListBullets,
  ListNumbers,
  PaperPlaneRight,
  Paperclip,
  Plus,
  Quotes,
  ShieldStar,
  Smiley,
  TextAa,
  TextB,
  TextItalic,
  TextStrikethrough,
  X
} from '@phosphor-icons/react'
import { Avatar } from '@renderer/components/common/avatar'
import { ChannelKindIcon } from '@renderer/components/chat/channel-kind-icon'
import {
  ComposerContext,
  useChatComposer,
  type ComposerContextValue,
  type PendingAttachment
} from '@renderer/components/chat/chat-composer-context'
import type { OutboxAttachment } from '@renderer/store/outbox-store'
import { useWorkspaceDirectory } from '@renderer/components/chat/workspace-directory-context'
import { EmojiPickerPanel } from '@renderer/components/pickers/emoji-picker'
import { GifPicker, type PickedMediaKind } from '@renderer/components/pickers/gif-picker'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { Spinner } from '@renderer/components/ui/spinner'
import { toast } from 'sonner'
import { formatBytes } from '@renderer/lib/format-bytes'
import { MAX_UPLOAD_LABEL, withinUploadLimit } from '@renderer/lib/upload-limits'
import { convexEnabled } from '@renderer/lib/auth-client'
import { docToMarkdown, markdownToHtml } from '@renderer/lib/tiptap-markdown'
import {
  MentionNode,
  channelMentionEntries,
  userMentionEntries,
  type MentionChannel,
  type MentionMember
} from '@renderer/lib/tiptap-mention'
import { DEFAULT_SLASH_COMMANDS } from '@renderer/lib/tiptap-slash-command'
import {
  SuggestionMenu,
  filterSuggestions,
  type SuggestionEntry
} from '@renderer/lib/tiptap-suggestion'
import { cn } from '@renderer/lib/utils'
import './chat-composer.css'

// ── Root ─────────────────────────────────────────────────────────────────────

interface MenuState {
  open: boolean
  items: SuggestionEntry[]
  index: number
  rect: { left: number; top: number } | null
}

const EMPTY_MENU: MenuState = { open: false, items: [], index: 0, rect: null }

interface ChatComposerProps {
  placeholder: string
  /** `message` (default) — Enter sends and the editor clears. `field` — a rich
   *  **form field**: Enter makes a new paragraph, nothing clears, and the current
   *  Markdown streams out through `onChange`. */
  mode?: 'message' | 'field'
  /** Required in `message` mode. The editor is cleared before this runs. Gets the
   *  Markdown plus any uploaded attachments (already in R2). */
  onSubmit?: (markdown: string, attachments?: OutboxAttachment[]) => void | Promise<void>
  /** Upload a picked file to R2 and resolve its object key. When omitted the
   *  composer takes no attachments (the Attach button hides) — that's the mock /
   *  no-backend path, where there's no `useUploadFile`. */
  onUpload?: (file: File) => Promise<string>
  /** Delete an uploaded object the user removed from the composer before sending,
   *  so an abandoned upload doesn't linger in R2. Paired with `onUpload`. */
  onRemoveUpload?: (key: string) => void
  /** `field` mode only: the Markdown, on every keystroke. */
  onChange?: (markdown: string) => void
  onCancel?: () => void
  autoFocus?: boolean
  /** Edge-triggered focus: the editor grabs focus when it first mounts (opening a
   *  channel/thread) AND every time this value changes. The channel composer passes
   *  a key that changes when a reply target is set — the composer isn't remounted
   *  then, so the caret would otherwise stay put. Distinct from `autoFocus`, which
   *  only focuses at editor creation (edit-in-place). */
  focusKey?: string | number
  /** Pre-fill the editor (edit-in-place, or a field's current value). Parsed via
   *  `markdownToHtml`. Read **once**, at mount. */
  initialMarkdown?: string
  /** Minimal (Discord-style single row) by default; the `Aa` toggle shows the
   *  formatting toolbar. Pass `expanded` + `onExpandedChange` to control it (the
   *  channel composer does, so the choice persists); otherwise it's internal. */
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  defaultExpanded?: boolean
  slashCommands?: SuggestionEntry[]
  className?: string
  children: React.ReactNode
}

/** Slack/Discord-style chat composer, built as a **compound component** so the
 *  same editor powers the channel composer, thread replies, and edit-in-place —
 *  each assembling only the parts it needs.
 *
 *  WYSIWYG (TipTap v3) → serialized to Markdown on submit. Enter sends (except
 *  inside a code block/list, or while an autocomplete is open); Shift+Enter is a
 *  line break; Cmd/Ctrl+Enter always sends.
 *
 *  Three autocompletes share one menu (as in `_zinx`/`zinx-os`): `/` formatting
 *  commands, `@` members + role groups, `#` channels. The `@`/`#` catalogues come
 *  from the workspace directory, so they're empty (and the trigger inert) in the
 *  mock/no-backend build. */
function ChatComposerRoot({
  placeholder,
  mode = 'message',
  onSubmit,
  onUpload,
  onRemoveUpload,
  onChange,
  onCancel,
  autoFocus,
  focusKey,
  initialMarkdown,
  expanded: expandedProp,
  onExpandedChange,
  defaultExpanded = false,
  slashCommands = DEFAULT_SLASH_COMMANDS,
  className,
  children
}: ChatComposerProps): React.JSX.Element {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded)
  const expanded = expandedProp ?? internalExpanded
  const toggleExpanded = useCallback(() => {
    const next = !expanded
    if (onExpandedChange) onExpandedChange(next)
    else setInternalExpanded(next)
  }, [expanded, onExpandedChange])
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [gifOpen, setGifOpen] = useState(false)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [menu, setMenu] = useState<MenuState>(EMPTY_MENU)

  const directory = useWorkspaceDirectory()

  // The editor is built once; everything it can reach into is routed through refs
  // so a late-arriving member list (or a new `onSubmit`) is never stale.
  const submitRef = useRef<() => void>(() => {})
  const attachFilesRef = useRef<(files: File[]) => void>(() => {})
  const menuOpenRef = useRef(false)
  const menuRef = useRef<{
    items: SuggestionEntry[]
    index: number
    pick: ((item: SuggestionEntry) => void) | null
  }>({ items: [], index: 0, pick: null })
  const sourcesRef = useRef<{
    slash: SuggestionEntry[]
    members: MentionMember[]
    channels: MentionChannel[]
    canModerate: boolean
  }>({ slash: slashCommands, members: [], channels: [], canModerate: false })

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
    sourcesRef.current = {
      slash: slashCommands,
      members,
      channels,
      canModerate: directory?.canModerate ?? false
    }
  }, [slashCommands, members, channels, directory?.canModerate])

  useEffect(() => {
    menuOpenRef.current = menu.open
  }, [menu.open])

  const setIndex = useCallback((next: number) => {
    menuRef.current.index = next
    setMenu((state) => ({ ...state, index: next }))
  }, [])

  const closeMenu = useCallback(() => {
    menuRef.current = { items: [], index: 0, pick: null }
    setMenu(EMPTY_MENU)
  }, [])

  const SubmitOnEnter = useMemo(
    () =>
      Extension.create({
        name: 'chatSubmit',
        addKeyboardShortcuts() {
          const send = (): boolean => {
            submitRef.current()
            return true
          }
          return {
            'Mod-Enter': send,
            Enter: ({ editor }) => {
              // An open autocomplete owns Enter.
              if (menuOpenRef.current) return false
              // Structured content keeps its native Enter behaviour.
              if (editor.isActive('codeBlock') || editor.isActive('listItem')) return false
              return send()
            }
          }
        }
      }),
    []
  )

  // These are `useCallback`s (not inline in the `useMemo`s below) so the refs they
  // close over are only ever read when TipTap invokes them — never during render.
  const applyEntry = useCallback(
    ({
      editor,
      range,
      props: entry
    }: {
      editor: Editor
      range: { from: number; to: number }
      props: SuggestionEntry
    }) => {
      entry.apply({
        editor,
        range,
        openGif: () => setGifOpen(true),
        openEmoji: () => setEmojiOpen(true)
      })
    },
    []
  )

  const renderMenu = useCallback(() => {
    const toRect = (
      clientRect: SuggestionProps<SuggestionEntry>['clientRect']
    ): { left: number; top: number } | null => {
      const box = clientRect?.()
      return box ? { left: box.left, top: box.top } : null
    }
    return {
      onStart: (suggestion: SuggestionProps<SuggestionEntry>) => {
        menuRef.current = { items: suggestion.items, index: 0, pick: suggestion.command }
        setMenu({
          open: true,
          items: suggestion.items,
          index: 0,
          rect: toRect(suggestion.clientRect)
        })
      },
      onUpdate: (suggestion: SuggestionProps<SuggestionEntry>) => {
        menuRef.current.items = suggestion.items
        menuRef.current.pick = suggestion.command
        setMenu((state) => ({
          open: true,
          items: suggestion.items,
          index: Math.min(state.index, Math.max(0, suggestion.items.length - 1)),
          rect: toRect(suggestion.clientRect)
        }))
      },
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        const { items, index, pick } = menuRef.current
        if (!items.length) return false
        if (event.key === 'ArrowDown') {
          setIndex((index + 1) % items.length)
          return true
        }
        if (event.key === 'ArrowUp') {
          setIndex((index - 1 + items.length) % items.length)
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          pick?.(items[index])
          return true
        }
        if (event.key === 'Escape') {
          closeMenu()
          return true
        }
        return false
      },
      onExit: () => closeMenu()
    }
  }, [setIndex, closeMenu])

  const slashItems = useCallback(
    ({ query }: { query: string }) => filterSuggestions(sourcesRef.current.slash, query),
    []
  )
  const userItems = useCallback(({ query }: { query: string }) => {
    const { members: people, canModerate } = sourcesRef.current
    return userMentionEntries(query, people, { canModerate })
  }, [])
  const channelItems = useCallback(
    ({ query }: { query: string }) => channelMentionEntries(query, sourcesRef.current.channels),
    []
  )

  /* eslint-disable react-hooks/refs -- TipTap calls these only from editor
     events, never during React render. Reading the sources through a ref is what
     lets the editor be built once: rebuilding it when the member list finally
     loads would throw away whatever the user had typed. */
  const suggestionExtensions = useMemo(
    () => [
      // `/` only at the start of a message, like Slack/Discord.
      SuggestionMenu.extend({ name: 'slashCommand' }).configure({
        char: '/',
        startOfLine: true,
        suggestion: { items: slashItems, command: applyEntry, render: renderMenu }
      }),
      SuggestionMenu.extend({ name: 'userMention' }).configure({
        char: '@',
        suggestion: { items: userItems, command: applyEntry, render: renderMenu }
      }),
      SuggestionMenu.extend({ name: 'channelMention' }).configure({
        char: '#',
        suggestion: { items: channelItems, command: applyEntry, render: renderMenu }
      })
    ],
    [slashItems, userItems, channelItems, applyEntry, renderMenu]
  )
  /* eslint-enable react-hooks/refs */

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: true }
      }),
      // Inline so a GIF sits inside its paragraph, matching `![gif](url)` — and
      // so editing a message containing a GIF doesn't drop the image.
      Image.configure({ inline: true, allowBase64: false }),
      MentionNode,
      Placeholder.configure({ placeholder }),
      ...suggestionExtensions,
      // A form field must be able to press Enter for a new paragraph.
      ...(mode === 'message' ? [SubmitOnEnter] : [])
    ],
    content: initialMarkdown ? markdownToHtml(initialMarkdown) : undefined,
    editorProps: {
      attributes: { class: 'chat-prose' },
      // Paste a file of ANY type (a screenshot, or a file copied in the OS file manager) →
      // upload it as an attachment instead of letting ProseMirror try to inline it. Text
      // paste is untouched (no files on the clipboard → return false, editor handles it).
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? [])
        if (files.length === 0) return false
        attachFilesRef.current(files)
        return true
      }
    },
    autofocus: autoFocus
  })

  // `field` mode streams its value out. Subscribed in an effect rather than via
  // `useEditor`'s `onUpdate`, so the callback is never stale and no ref crosses
  // into the editor's options during render.
  useEffect(() => {
    if (!editor || mode !== 'field' || !onChange) return
    const emit = (): void => onChange(docToMarkdown(editor.getJSON()))
    editor.on('update', emit)
    return () => {
      editor.off('update', emit)
    }
  }, [editor, mode, onChange])

  // TipTap applies `autofocus` only when the editor is *created*, and the channel
  // composer isn't remounted when you hit Reply — so without this the "Replying
  // to …" chip appears but the caret never moves into the box.
  useEffect(() => {
    if (autoFocus && editor) editor.commands.focus('end')
  }, [autoFocus, editor])

  // Edge-triggered focus: fires when the editor is first created (opening a channel
  // or thread → focus the composer) and again whenever `focusKey` changes (a reply
  // target is set/cleared). One effect covers both because the editor's creation is
  // itself a change of this effect's deps.
  useEffect(() => {
    if (focusKey !== undefined && editor) editor.commands.focus('end')
  }, [focusKey, editor])

  const active = useEditorState({
    editor,
    selector: (context) => {
      const instance = context.editor
      if (!instance) return null
      return {
        bold: instance.isActive('bold'),
        italic: instance.isActive('italic'),
        strike: instance.isActive('strike'),
        code: instance.isActive('code'),
        codeBlock: instance.isActive('codeBlock'),
        blockquote: instance.isActive('blockquote'),
        bulletList: instance.isActive('bulletList'),
        orderedList: instance.isActive('orderedList'),
        link: instance.isActive('link'),
        isEmpty: instance.isEmpty
      }
    }
  })

  const MAX_ATTACHMENTS = 10
  const attachFiles = useCallback(
    (files: FileList | File[]) => {
      if (!onUpload) return
      const list = Array.from(files)
      for (const file of list) {
        // Keep total storage bounded — reject oversized files before they touch R2.
        if (!withinUploadLimit(file.size)) {
          toast.error(`"${file.name}" is larger than ${MAX_UPLOAD_LABEL}`)
          continue
        }
        const id = crypto.randomUUID()
        const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
        setAttachments((prev) => {
          if (prev.length >= MAX_ATTACHMENTS) {
            if (previewUrl) URL.revokeObjectURL(previewUrl)
            return prev
          }
          return [
            ...prev,
            {
              id,
              name: file.name,
              contentType: file.type || 'application/octet-stream',
              size: file.size,
              previewUrl,
              status: 'uploading'
            }
          ]
        })
        onUpload(file)
          .then((key) =>
            setAttachments((prev) =>
              prev.map((a) => (a.id === id ? { ...a, key, status: 'ready' } : a))
            )
          )
          .catch(() =>
            setAttachments((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'error' } : a)))
          )
      }
    },
    [onUpload]
  )

  const removeAttachment = useCallback(
    (id: string) => {
      setAttachments((prev) => {
        const gone = prev.find((a) => a.id === id)
        if (gone) {
          // Manual remove (the ✕) — safe to revoke the preview (submit never routes
          // through here). If it already reached R2, delete the object so an
          // abandoned upload doesn't linger.
          if (gone.previewUrl) URL.revokeObjectURL(gone.previewUrl)
          if (gone.status === 'ready' && gone.key) onRemoveUpload?.(gone.key)
        }
        return prev.filter((a) => a.id !== id)
      })
    },
    [onRemoveUpload]
  )

  const submit = useCallback(() => {
    if (!editor || !onSubmit) return
    // Don't send while a file is still uploading — wait for it.
    if (attachments.some((a) => a.status === 'uploading')) return
    const ready = attachments.filter(
      (a): a is PendingAttachment & { key: string } => a.status === 'ready' && !!a.key
    )
    const markdown = docToMarkdown(editor.getJSON())
    // A message needs text or at least one attachment.
    if (!markdown && ready.length === 0) return

    const sent: OutboxAttachment[] = ready.map((a) => ({
      key: a.key,
      name: a.name,
      contentType: a.contentType,
      size: a.size,
      previewUrl: a.previewUrl
    }))
    // Clear optimistically, but put the draft back if the send/save fails —
    // losing a typed message to a network blip is unforgivable.
    const draft = editor.getJSON()
    editor.commands.clearContent(true)
    setAttachments([])
    void Promise.resolve(onSubmit(markdown, sent.length > 0 ? sent : undefined)).catch(() => {
      editor.commands.setContent(draft)
      setAttachments(ready)
    })
  }, [editor, onSubmit, attachments])

  useEffect(() => {
    submitRef.current = submit
  }, [submit])

  // Route the editor's paste handler (built once) to the current `attachFiles`.
  useEffect(() => {
    attachFilesRef.current = attachFiles
  }, [attachFiles])

  const insert = useCallback(
    (text: string) => {
      editor?.chain().focus().insertContent(text).run()
    },
    [editor]
  )

  const sendGif = useCallback(
    (url: string, kind: PickedMediaKind = 'gif') => {
      setGifOpen(false)
      // A GIF/sticker is its own message; in a field it's just an inline image.
      // The alt (`gif` / `sticker`) rides the markdown so previews can label it.
      if (mode === 'field') {
        editor?.chain().focus().setImage({ src: url, alt: kind }).run()
        return
      }
      void onSubmit?.(`![${kind}](${url})`)
    },
    [mode, editor, onSubmit]
  )

  const value = useMemo<ComposerContextValue>(
    () => ({
      editor,
      active,
      submit,
      onCancel,
      insert,
      expanded,
      toggleExpanded,
      gifOpen,
      setGifOpen,
      sendGif,
      emojiOpen,
      setEmojiOpen,
      canAttach: Boolean(onUpload),
      attachments,
      attachFiles,
      removeAttachment
    }),
    [
      editor,
      active,
      submit,
      onCancel,
      insert,
      expanded,
      toggleExpanded,
      gifOpen,
      sendGif,
      emojiOpen,
      onUpload,
      attachments,
      attachFiles,
      removeAttachment
    ]
  )

  return (
    <ComposerContext.Provider value={value}>
      <div className={cn('w-full', className)}>{children}</div>

      {/* Portaled: the composer box clips, and the caret rect is viewport-based. */}
      {menu.open && menu.items.length > 0 && menu.rect
        ? createPortal(
            <SuggestionMenuList
              menu={menu}
              onPick={(item) => menuRef.current.pick?.(item)}
              onHover={setIndex}
            />,
            document.body
          )
        : null}
    </ComposerContext.Provider>
  )
}

/** The shared autocomplete popup — one look for `/`, `@` and `#`, with section
 *  headers when the entries carry a `group` (`zinx-os`'s `AutocompleteMenu`). */
function SuggestionMenuList({
  menu,
  onPick,
  onHover
}: {
  menu: MenuState
  onPick: (item: SuggestionEntry) => void
  onHover: (index: number) => void
}): React.JSX.Element {
  const activeRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [menu.index])

  return (
    <div
      style={{ left: menu.rect?.left, top: (menu.rect?.top ?? 0) - 8 }}
      // Portaled to `document.body`, so to a modal Dialog this menu is an *outside*
      // click — picking an item would otherwise dismiss the whole dialog. Base UI's
      // outside-press listener sits on `document` in the bubble phase, so stopping
      // propagation here is enough. (No-op in the channel composer.)
      onPointerDown={(event) => event.stopPropagation()}
      className="fixed z-50 w-80 -translate-y-full overflow-hidden rounded-lg border bg-popover shadow-xl"
    >
      <div className="no-scrollbar max-h-72 overflow-y-auto p-1">
        {menu.items.map((item, index) => {
          // Entries arrive pre-grouped, so a header is just "differs from the
          // previous entry's group".
          const header =
            item.group && item.group !== menu.items[index - 1]?.group ? item.group : null
          return (
            <div key={item.id}>
              {header ? (
                <p className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {header}
                </p>
              ) : null}
              <button
                ref={index === menu.index ? activeRef : null}
                type="button"
                // Keep the editor selection — the caret must survive the click.
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onHover(index)}
                onClick={() => onPick(item)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                  index === menu.index ? 'bg-accent' : 'hover:bg-accent'
                )}
              >
                <SuggestionGlyph entry={item} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.label}</span>
                  {item.description ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  ) : null}
                </span>
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SuggestionGlyph({ entry }: { entry: SuggestionEntry }): React.JSX.Element | null {
  if (entry.avatar) {
    return (
      <Avatar
        initials={entry.avatar.initials}
        color={entry.avatar.color}
        image={entry.avatar.image}
        className="size-6 text-[10px]"
      />
    )
  }
  if (entry.icon === 'group') {
    return <ShieldStar className="size-5 shrink-0 text-muted-foreground" weight="fill" />
  }
  if (entry.icon === 'silent') {
    return <BellSlash className="size-5 shrink-0 text-muted-foreground" weight="fill" />
  }
  if (entry.icon) {
    return <ChannelKindIcon kind={entry.icon} className="size-5 shrink-0 text-muted-foreground" />
  }
  return null
}

// ── Parts ────────────────────────────────────────────────────────────────────

/** Bordered container. `variant="edit"` highlights it for edit-in-place;
 *  `variant="field"` makes it a form field — taller, top-aligned, and styled like
 *  the app's other inputs.
 *
 *  `min-h-13` (52px) makes the compact composer exactly as tall as the sidebar's
 *  floating user bar (`common/user-panel.tsx` — a `size-8` avatar + its `p-1`
 *  inside the bar's `py-1.5`), so the two sit level along the bottom of the
 *  window. The single input row is 48px, so `justify-center` splits the 2px of
 *  slack evenly rather than pooling it above the controls. */
function ComposerBox({
  children,
  className,
  variant = 'default'
}: {
  children: React.ReactNode
  className?: string
  variant?: 'default' | 'edit' | 'field'
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex min-h-13 flex-col justify-center rounded-lg border transition-colors',
        // Default message composer shares the sidebar user-bar's surface tone
        // (`bg-sidebar-accent/60`) so the two floating bars read as a pair.
        variant === 'default' &&
          'border-transparent bg-sidebar-accent/60 focus-within:border-ring/60',
        variant === 'edit' && 'border-primary/50 bg-card',
        variant === 'field' &&
          'justify-start border-input bg-transparent focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30',
        className
      )}
    >
      {children}
    </div>
  )
}

/** Formatting toolbar — only rendered when the composer is expanded. */
function ComposerToolbar(): React.JSX.Element | null {
  const { editor, active, expanded } = useChatComposer()
  if (!expanded) return null

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1">
      <ToolButton
        label="Bold"
        active={active?.bold}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <TextB className="size-4" weight="bold" />
      </ToolButton>
      <ToolButton
        label="Italic"
        active={active?.italic}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <TextItalic className="size-4" />
      </ToolButton>
      <ToolButton
        label="Strikethrough"
        active={active?.strike}
        onClick={() => editor?.chain().focus().toggleStrike().run()}
      >
        <TextStrikethrough className="size-4" />
      </ToolButton>

      <ToolDivider />
      <LinkButton />
      <ToolDivider />

      <ToolButton
        label="Bulleted list"
        active={active?.bulletList}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <ListBullets className="size-4" />
      </ToolButton>
      <ToolButton
        label="Numbered list"
        active={active?.orderedList}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <ListNumbers className="size-4" />
      </ToolButton>
      <ToolButton
        label="Blockquote"
        active={active?.blockquote}
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
      >
        <Quotes className="size-4" />
      </ToolButton>

      <ToolDivider />

      <ToolButton
        label="Inline code"
        active={active?.code}
        onClick={() => editor?.chain().focus().toggleCode().run()}
      >
        <Code className="size-4" />
      </ToolButton>
      <ToolButton
        label="Code block"
        active={active?.codeBlock}
        onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
      >
        <CodeBlock className="size-4" />
      </ToolButton>
    </div>
  )
}

/** The single input row: [attach] [editor] [actions]. */
/** The editor + action buttons. A **container query** reflows it: wide enough
 *  (channel composer, roomy window) it's a single row — editor grows, buttons on
 *  the right. Too narrow for that to leave real typing room (the thread panel),
 *  the editor claims its own full-width first line and the buttons wrap below it
 *  (`Editor` goes `basis-full order-first`; `Actions` gets `ml-auto`). */
function ComposerRow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="@container/cmprow relative flex flex-wrap items-end gap-1 px-2 py-1.5">
      {children}
    </div>
  )
}

function ComposerEditor({ className }: { className?: string }): React.JSX.Element {
  const { editor } = useChatComposer()
  return (
    // `py-2` makes a single line 36px tall — the same as the action buttons — so
    // the row's `items-end` alignment leaves no gap between text and icons.
    <EditorContent
      editor={editor}
      className={cn(
        'no-scrollbar max-h-52 min-w-0 flex-1 overflow-y-auto px-1 py-2 text-sm',
        // When the row is too narrow to share a line, the editor takes the whole
        // first line (buttons wrap beneath) — see `ComposerRow`.
        '@max-[22rem]/cmprow:order-first @max-[22rem]/cmprow:basis-full',
        className
      )}
    />
  )
}

function ComposerActions({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    // `ml-auto` only once wrapped — keeps the action cluster hard-right on its own
    // line while the attach button stays left.
    <div className="relative flex shrink-0 items-center gap-0.5 @max-[22rem]/cmprow:ml-auto">
      {children}
    </div>
  )
}

/** The `+` affordance — opens a file picker and hands the files to the composer's
 *  uploader. Hidden when the composer has no `onUpload` (mock / no-backend). */
function ComposerAttach(): React.JSX.Element | null {
  const { canAttach, attachFiles } = useChatComposer()
  const inputRef = useRef<HTMLInputElement>(null)
  if (!canAttach) return null
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        onChange={(event) => {
          if (event.target.files) attachFiles(event.target.files)
          event.target.value = ''
        }}
        className="sr-only"
      />
      <ToolButton label="Attach files" onClick={() => inputRef.current?.click()}>
        <Plus className="size-5" />
      </ToolButton>
    </>
  )
}

/** Preview strip for files the composer is holding — thumbnails for images, a
 *  labelled chip for everything else, each with an upload spinner or a remove
 *  button. Renders nothing when empty. */
function ComposerAttachments(): React.JSX.Element | null {
  const { attachments, removeAttachment } = useChatComposer()
  if (attachments.length === 0) return null
  return (
    <div className="flex flex-wrap gap-2 border-b px-3 py-2">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="group/att relative flex items-center gap-2 rounded-lg border bg-background/60 p-1.5 pr-2"
        >
          <div className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
            {attachment.previewUrl ? (
              <img src={attachment.previewUrl} alt="" className="size-full object-cover" />
            ) : (
              <Paperclip className="size-4 text-muted-foreground" />
            )}
            {attachment.status === 'uploading' ? (
              <span className="absolute inset-0 flex items-center justify-center bg-black/50">
                <Spinner className="size-4 text-white" />
              </span>
            ) : null}
          </div>
          <div className="min-w-0 max-w-40">
            <p className="truncate text-xs font-medium">{attachment.name}</p>
            <p className="text-[10px] text-muted-foreground">
              {attachment.status === 'error' ? 'Upload failed' : formatBytes(attachment.size)}
            </p>
          </div>
          <button
            type="button"
            aria-label={`Remove ${attachment.name}`}
            onClick={() => removeAttachment(attachment.id)}
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" weight="bold" />
          </button>
        </div>
      ))}
    </div>
  )
}

/** Minimal ⇄ expanded toggle (shows/hides the formatting toolbar). */
function ComposerFormatToggle(): React.JSX.Element {
  const { expanded, toggleExpanded } = useChatComposer()
  return (
    <ToolButton
      label={expanded ? 'Hide formatting' : 'Show formatting'}
      active={expanded}
      onClick={toggleExpanded}
    >
      <TextAa className="size-5" />
    </ToolButton>
  )
}

/** Both pickers use a real `Popover` so Base UI portals them (no clipping by the
 *  composer/shell) and flips/shifts them when there isn't room above. */
const PICKER_POPOVER = 'w-auto rounded-none border-none bg-transparent p-0 shadow-none ring-0'

function ComposerEmoji(): React.JSX.Element {
  const { emojiOpen, setEmojiOpen, insert } = useChatComposer()
  return (
    <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
      <PopoverTrigger
        title="Emoji"
        aria-label="Emoji"
        aria-pressed={emojiOpen}
        className={cn(ACTION_BUTTON, emojiOpen && 'bg-accent text-foreground')}
      >
        <Smiley className="size-5" />
      </PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className={PICKER_POPOVER}>
        <EmojiPickerPanel
          onSelect={(emoji) => {
            insert(emoji)
            setEmojiOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

function ComposerGif(): React.JSX.Element | null {
  const { gifOpen, setGifOpen, sendGif } = useChatComposer()
  if (!convexEnabled) return null
  return (
    <Popover open={gifOpen} onOpenChange={setGifOpen}>
      <PopoverTrigger
        title="GIFs & stickers"
        aria-label="GIFs & stickers"
        aria-pressed={gifOpen}
        className={cn(ACTION_BUTTON, gifOpen && 'bg-accent text-foreground')}
      >
        <span className="text-xs font-bold tracking-tight">GIF</span>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className={PICKER_POPOVER}>
        <GifPicker onSelect={sendGif} />
      </PopoverContent>
    </Popover>
  )
}

function ComposerSubmit({ label = 'Send message' }: { label?: string }): React.JSX.Element {
  const { submit, active, editor, attachments } = useChatComposer()
  const uploading = attachments.some((a) => a.status === 'uploading')
  const hasReadyAttachment = attachments.some((a) => a.status === 'ready')
  // Sendable when there's text OR a ready attachment; never while one uploads.
  const disabled = !editor || uploading || ((active?.isEmpty ?? true) && !hasReadyAttachment)
  return (
    <Button
      size="icon"
      className="size-9 shrink-0"
      disabled={disabled}
      onClick={submit}
      aria-label={label}
      title={label}
    >
      <PaperPlaneRight className="size-4.5" weight="fill" />
    </Button>
  )
}

function ComposerCancel({ label = 'Cancel' }: { label?: string }): React.JSX.Element | null {
  const { onCancel } = useChatComposer()
  if (!onCancel) return null
  return (
    <Button variant="ghost" size="sm" className="h-9" onClick={onCancel}>
      {label}
    </Button>
  )
}

// ── Shared bits ──────────────────────────────────────────────────────────────

/** 36px square — matches a single line of the editor, so the input row is one
 *  even band inside the 52px box. Shared by the toolbar, the `Aa`/attach
 *  toggles, and the emoji/GIF/link popover triggers. */
const ACTION_BUTTON =
  'flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'

function ToolButton({
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
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      // Keep the editor selection when clicking a toolbar button.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(ACTION_BUTTON, active && 'bg-accent text-foreground')}
    >
      {children}
    </button>
  )
}

function ToolDivider(): React.JSX.Element {
  return <span className="mx-1 h-4 w-px bg-border" />
}

/** Link toggle — a small popover with a URL field (no browser `prompt`). */
function LinkButton(): React.JSX.Element {
  const { editor, active } = useChatComposer()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')

  const apply = (): void => {
    if (!editor) return
    const href = url.trim()
    if (!href) {
      editor.chain().focus().unsetLink().run()
    } else {
      const safe = /^https?:\/\//i.test(href) ? href : `https://${href}`
      editor.chain().focus().extendMarkRange('link').setLink({ href: safe }).run()
    }
    setUrl('')
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) setUrl(editor?.getAttributes('link').href ?? '')
      }}
    >
      <PopoverTrigger
        title="Link"
        aria-label="Link"
        aria-pressed={active?.link}
        onMouseDown={(event) => event.preventDefault()}
        className={cn(ACTION_BUTTON, active?.link && 'bg-accent text-foreground')}
      >
        <LinkSimple className="size-4" />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72">
        <div className="flex items-center gap-1.5">
          <Input
            autoFocus
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                apply()
              }
            }}
            placeholder="https://example.com"
            className="h-8 text-sm"
          />
          <Button size="sm" className="h-8" onClick={apply}>
            {url.trim() ? 'Apply' : 'Remove'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ── Compound export ──────────────────────────────────────────────────────────

export const ChatComposer = Object.assign(ChatComposerRoot, {
  Box: ComposerBox,
  Toolbar: ComposerToolbar,
  Row: ComposerRow,
  Editor: ComposerEditor,
  Actions: ComposerActions,
  Attach: ComposerAttach,
  Attachments: ComposerAttachments,
  FormatToggle: ComposerFormatToggle,
  Emoji: ComposerEmoji,
  Gif: ComposerGif,
  Submit: ComposerSubmit,
  Cancel: ComposerCancel
})
