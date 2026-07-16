import { Extension, type Editor } from '@tiptap/react'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion'

/** One shared shape for every composer autocomplete — `/` commands, `@` people
 *  and roles, `#` channels. Each entry knows how to apply itself, so the menu UI
 *  and the TipTap plugin stay completely generic.
 *
 *  (`_zinx`/`zinx-os` do the same thing with one `AutocompleteMenu` fed by three
 *  triggers; theirs runs over a textarea, ours over ProseMirror.) */
export interface SuggestionApplyContext {
  editor: Editor
  /** The document range covering the trigger char + the typed query. */
  range: { from: number; to: number }
  openGif: () => void
  openEmoji: () => void
}

/** The left-hand visual for a menu row. Kept as a *token*, not a `ReactNode`, so
 *  entry builders stay in plain `.ts` and the menu owns all rendering. */
export type SuggestionIcon =
  'chat' | 'voice' | 'page' | 'kanban' | 'whiteboard' | 'group' | 'silent'

export interface SuggestionEntry {
  id: string
  label: string
  description?: string
  /** Section header in the menu. Entries must already be ordered by group. */
  group?: string
  /** Extra search terms (e.g. the `/quote` alias for "Blockquote"). */
  keywords?: string[]
  avatar?: { initials: string; color: string; image?: string | null }
  icon?: SuggestionIcon
  apply: (context: SuggestionApplyContext) => void
}

interface SuggestionExtensionOptions {
  char: string
  startOfLine: boolean
  suggestion: Partial<SuggestionOptions<SuggestionEntry>>
}

/** Wires one `@tiptap/suggestion` plugin. `.extend({ name })` it per trigger —
 *  the plugin key is derived from the name, so the three instances don't collide.
 *
 *  `priority: 200` puts its keymap above the composer's Enter-to-send, letting an
 *  open menu take Enter first. */
export const SuggestionMenu = Extension.create<SuggestionExtensionOptions>({
  name: 'suggestionMenu',
  priority: 200,

  addOptions() {
    return { char: '/', startOfLine: false, suggestion: {} }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<SuggestionEntry>({
        editor: this.editor,
        char: this.options.char,
        startOfLine: this.options.startOfLine,
        pluginKey: new PluginKey(this.name),
        allowSpaces: false,
        ...this.options.suggestion
      })
    ]
  }
})

/** Filter + cap a flat entry list by the text typed after the trigger. Matches on
 *  the label and on any keyword; preserves the caller's (grouped) order. */
export function filterSuggestions(
  entries: SuggestionEntry[],
  query: string,
  limit = 10
): SuggestionEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return entries.slice(0, limit)
  return entries
    .filter(
      (entry) =>
        entry.label.toLowerCase().includes(q) ||
        entry.keywords?.some((keyword) => keyword.toLowerCase().includes(q))
    )
    .slice(0, limit)
}
