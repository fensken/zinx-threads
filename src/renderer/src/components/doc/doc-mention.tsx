import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'

import { MentionPill } from '@renderer/components/chat/mention-pill'
import { MENTION_PREFIX, mentionHref, type MentionKind } from '@renderer/lib/mention'
import { MentionNode } from '@renderer/lib/tiptap-mention'

/**
 * The doc editor's mention pill — the SAME `MentionNode` the chat composer uses (same name,
 * same attributes, so a mention means one thing across the app), given a React node view
 * that renders the SAME `MentionPill` a chat message does.
 *
 * That's the whole point of the shared `zinx://` scheme: `@Alice` in a doc gets the profile
 * popover, `#general` navigates, `@everyone` reads as a role — with no second
 * implementation to keep in step.
 *
 * The chat composer deliberately does NOT get this node view: there, a pill is something
 * you're still authoring, and clicking it should not yank you off a half-written message.
 * Here you're reading a document, so a pill is a link.
 */
export const DocMentionNode = MentionNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(DocMentionView)
  }
})

function DocMentionView({ node }: NodeViewProps): React.JSX.Element {
  const kind = (node.attrs.kind as MentionKind) ?? 'user'
  const id = String(node.attrs.mentionId ?? '')
  const label = String(node.attrs.label ?? '')

  return (
    // `as="span"` — a mention is inline content, and TipTap's default <div> wrapper would
    // break the line it sits in. `contentEditable={false}` keeps the caret out of the pill;
    // the node is an atom, so it is selected and deleted as one unit.
    <NodeViewWrapper as="span" className="zinx-mention-node" contentEditable={false}>
      <MentionPill href={mentionHref(kind, id)} fallbackLabel={`${MENTION_PREFIX[kind]}${label}`} />
    </NodeViewWrapper>
  )
}
