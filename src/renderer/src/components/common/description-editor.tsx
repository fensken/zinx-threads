import { ChatComposer } from '@renderer/components/chat/chat-composer'

/**
 * The ONE rich description editor, used anywhere the app takes a "description" — the same
 * WYSIWYG editor the chat composer + kanban task use, in `field` mode (Enter makes a
 * paragraph; the Markdown streams out via `onChange`). It has `/` commands, `@` mentions and
 * `#` channels built in (via the workspace directory the shell provides).
 *
 * `initialMarkdown` is read ONCE at mount, so callers must key the component per value.
 */
export function DescriptionEditor({
  initialMarkdown,
  onChange,
  placeholder,
  className
}: {
  initialMarkdown?: string
  onChange: (markdown: string) => void
  placeholder?: string
  className?: string
}): React.JSX.Element {
  return (
    <ChatComposer
      mode="field"
      placeholder={placeholder ?? "Add a description… (Markdown, or type '/' for commands)"}
      initialMarkdown={initialMarkdown}
      onChange={onChange}
      defaultExpanded
    >
      <ChatComposer.Box variant="field">
        <ChatComposer.Toolbar />
        <ChatComposer.Row>
          <ChatComposer.Editor className={className ?? 'max-h-64 min-h-20'} />
          <ChatComposer.Actions>
            <ChatComposer.Emoji />
          </ChatComposer.Actions>
        </ChatComposer.Row>
      </ChatComposer.Box>
    </ChatComposer>
  )
}
