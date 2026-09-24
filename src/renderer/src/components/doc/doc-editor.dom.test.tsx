/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'

import { buildDocExtensions, parseDocContent } from '@renderer/components/doc/doc-extensions'
import { createDocSlashCommands } from '@renderer/components/doc/doc-slash-commands'

/**
 * The doc editor's keyboard + command behaviour, against a real DOM.
 *
 * These exist because the failure they cover is invisible to `typecheck`, `lint` and the
 * build: an extension that quietly loses a keybinding, or a `/` command whose chain no
 * longer applies, produces an editor that renders perfectly and does nothing. ProseMirror's
 * keymaps only exist against a document, so this is the only place the question can be
 * asked at all.
 */

function makeEditor(): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  return new Editor({
    element,
    extensions: buildDocExtensions({
      sources: { current: { members: [], channels: [], canModerate: false } },
      upload: async () => '',
      openEmoji: () => {},
      openBookmark: () => {}
    }),
    content: parseDocContent(null)
  })
}

describe('doc editor keyboard', () => {
  it('splits the block on Enter', () => {
    const editor = makeEditor()
    editor.commands.insertContent('Hello')
    expect(editor.state.doc.childCount).toBe(1)

    // `keyboardShortcutHandler` is what a real Enter keypress runs through.
    const handled = editor.view.someProp('handleKeyDown', (fn) =>
      fn(editor.view, new KeyboardEvent('keydown', { key: 'Enter' }))
    )

    expect(handled).toBe(true)
    expect(editor.state.doc.childCount).toBe(2)
    editor.destroy()
  })

  it('leaves Enter alone when no suggestion is open', () => {
    const editor = makeEditor()
    // Each `/`, `@` and `#` plugin sits at priority 200, ahead of everything else. If one of
    // them claimed Enter while INACTIVE, typing would never break a line — which is exactly
    // what a stuck suggestion session looks like from the outside.
    editor.commands.insertContent('plain text')
    editor.view.someProp('handleKeyDown', (fn) =>
      fn(editor.view, new KeyboardEvent('keydown', { key: 'Enter' }))
    )
    expect(editor.state.doc.childCount).toBe(2)
    editor.destroy()
  })
})

describe('doc slash commands', () => {
  /** Run a command the way the suggestion menu does: over the typed `/query` range. */
  function runCommand(editor: Editor, id: string): void {
    const entry = createDocSlashCommands().find((command) => command.id === id)
    if (!entry) throw new Error(`No slash command "${id}"`)
    editor.commands.insertContent('/x')
    const to = editor.state.selection.from
    entry.apply({
      editor,
      range: { from: to - 2, to },
      openGif: () => {},
      openEmoji: () => {},
      openBookmark: () => {}
    })
  }

  // Every block the menu offers, so a broken chain can't hide behind the ones that work.
  const cases: { id: string; active: string; attrs?: Record<string, unknown> }[] = [
    { id: 'h1', active: 'heading', attrs: { level: 1 } },
    { id: 'h4', active: 'heading', attrs: { level: 4 } },
    { id: 'bullet-list', active: 'bulletList' },
    { id: 'numbered-list', active: 'orderedList' },
    { id: 'task-list', active: 'taskList' },
    { id: 'toggle-list', active: 'details' },
    { id: 'quote', active: 'blockquote' },
    { id: 'callout', active: 'callout' },
    { id: 'code-block', active: 'codeBlock' },
    { id: 'table', active: 'table' }
  ]

  for (const { id, active, attrs } of cases) {
    it(`\`/${id}\` produces a ${active}`, () => {
      const editor = makeEditor()
      runCommand(editor, id)
      expect(editor.isActive(active, attrs)).toBe(true)
      editor.destroy()
    })
  }

  it('`/columns-2` inserts two columns', () => {
    const editor = makeEditor()
    runCommand(editor, 'columns-2')
    let columns = 0
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'column') columns += 1
      return true
    })
    expect(columns).toBe(2)
    editor.destroy()
  })

  // A fresh editor each time: these are atoms, so running them back to back would leave the
  // selection inside one and the next insert would land somewhere unintended.
  const mediaCases: { id: string; node: string }[] = [
    { id: 'image', node: 'image' },
    { id: 'gif', node: 'image' },
    { id: 'video', node: 'attachment' },
    { id: 'audio', node: 'attachment' },
    { id: 'file', node: 'attachment' },
    { id: 'embed', node: 'embed' },
    { id: 'whiteboard', node: 'whiteboard' },
    { id: 'divider', node: 'horizontalRule' }
  ]

  for (const { id, node } of mediaCases) {
    it(`\`/${id}\` inserts a ${node} block`, () => {
      const editor = makeEditor()
      runCommand(editor, id)
      let found = false
      editor.state.doc.descendants((child) => {
        if (child.type.name === node) found = true
        return true
      })
      expect(found).toBe(true)
      editor.destroy()
    })
  }
})
