import { createContext, useContext } from 'react'
import type { Editor } from '@tiptap/react'
import type { PickedMediaKind } from '@renderer/components/pickers/gif-picker'

/** A file the composer is holding — mid-upload, ready to send, or failed. `key`
 *  is set once R2 has the bytes; `previewUrl` is a local `blob:` for images. */
export interface PendingAttachment {
  id: string
  name: string
  contentType: string
  size: number
  previewUrl?: string
  key?: string
  status: 'uploading' | 'ready' | 'error'
}

/** Which marks/nodes are active at the caret — drives the toolbar's pressed state. */
export interface ActiveMarks {
  bold: boolean
  italic: boolean
  strike: boolean
  code: boolean
  codeBlock: boolean
  blockquote: boolean
  bulletList: boolean
  orderedList: boolean
  link: boolean
  isEmpty: boolean
}

export interface ComposerContextValue {
  editor: Editor | null
  active: ActiveMarks | null
  submit: () => void
  onCancel?: () => void
  insert: (text: string) => void
  expanded: boolean
  toggleExpanded: () => void
  gifOpen: boolean
  setGifOpen: (open: boolean) => void
  /** Insert a picked GIF or sticker; `kind` tags the markdown alt. */
  sendGif: (url: string, kind?: PickedMediaKind) => void
  emojiOpen: boolean
  setEmojiOpen: (open: boolean) => void
  /** True when the composer can take file uploads (an `onUpload` was provided). */
  canAttach: boolean
  attachments: PendingAttachment[]
  /** Upload + hold files (from the picker or a paste/drop). No-op without upload. */
  attachFiles: (files: FileList | File[]) => void
  removeAttachment: (id: string) => void
}

export const ComposerContext = createContext<ComposerContextValue | null>(null)

/** Access the composer that the `ChatComposer.*` parts are rendered inside.
 *  (Lives in its own module so the component file only exports components —
 *  keeps react-refresh happy.) */
export function useChatComposer(): ComposerContextValue {
  const context = useContext(ComposerContext)
  if (!context) throw new Error('ChatComposer.* must be used inside <ChatComposer>')
  return context
}
