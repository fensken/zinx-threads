import { ChatComposer } from '@renderer/components/chat/chat-composer'
import { ReplyTarget, type ReplyTargetMessage } from '@renderer/components/chat/reply-target'
import { useSettingsStore } from '@renderer/store/settings-store'
import type { OutboxAttachment } from '@renderer/store/outbox-store'

/** The channel's message composer — assembles the `ChatComposer` compound into
 *  the Discord-style minimal row (formatting toolbar hidden until you toggle
 *  `Aa`). Mirrors how `_zinx`'s `chat-input.tsx` composes its `MessageEditor`.
 *
 *  When replying, a "Replying to …" chip sits flush above the box (`_zinx`'s
 *  `ReplyTarget`). The expanded/compact choice is persisted
 *  (`settings-store.composerExpanded`, localStorage; default compact).
 *
 *  `Attach` is intentionally not rendered yet — it only appears once a handler
 *  exists (uploads aren't wired), so there's no dead button. */
export function ChannelComposer({
  channelName,
  placeholder,
  onSend,
  onUpload,
  onRemoveUpload,
  onTyping,
  replyTo,
  onCancelReply
}: {
  channelName: string
  /** Overrides the default `Message #channel` (the thread panel says "Reply in …"). */
  placeholder?: string
  onSend: (markdown: string, attachments?: OutboxAttachment[]) => void | Promise<void>
  /** Broadcast a (throttled) "typing…" ping on each edit. Present only on the real
   *  path; the matching "stopped" is fired by the caller inside `onSend`. */
  onTyping?: () => void
  /** Upload a picked file to R2 → its object key. Present only on the real path;
   *  without it the Attach button hides (mock / no-backend). */
  onUpload?: (file: File) => Promise<string>
  /** Delete an unsent upload the user removed from the composer. */
  onRemoveUpload?: (key: string) => void
  replyTo?: ReplyTargetMessage | null
  onCancelReply?: () => void
}): React.JSX.Element {
  const expanded = useSettingsStore((state) => state.composerExpanded)
  const setExpanded = useSettingsStore((state) => state.setComposerExpanded)

  return (
    // `pb-2` matches the user bar's `mb-2`, so the composer and the sidebar's
    // floating user panel share a bottom edge (they're already the same height).
    <div className="shrink-0 px-4 pb-2">
      {replyTo && onCancelReply ? <ReplyTarget message={replyTo} onCancel={onCancelReply} /> : null}
      <ChatComposer
        placeholder={
          replyTo ? `Reply to ${replyTo.authorName}` : (placeholder ?? `Message #${channelName}`)
        }
        onSubmit={onSend}
        onUpload={onUpload}
        onRemoveUpload={onRemoveUpload}
        onTyping={onTyping}
        // Focus the box on mount (opening a channel or thread) and again whenever a
        // reply target is set/cleared — the composer isn't remounted between those.
        focusKey={replyTo?._id ?? 'compose'}
        expanded={expanded}
        onExpandedChange={setExpanded}
      >
        <ChatComposer.Box className={replyTo ? 'rounded-t-none' : undefined}>
          <ChatComposer.Toolbar />
          <ChatComposer.Attachments />
          <ChatComposer.Row>
            {/* Attach sits in the bottom-left corner (Discord-style), before the
                text; the rest of the actions stay bottom-right. */}
            <ChatComposer.Attach />
            <ChatComposer.Editor />
            <ChatComposer.Actions>
              <ChatComposer.FormatToggle />
              <ChatComposer.Gif />
              <ChatComposer.Emoji />
              <ChatComposer.Submit />
            </ChatComposer.Actions>
          </ChatComposer.Row>
        </ChatComposer.Box>
      </ChatComposer>
    </div>
  )
}
