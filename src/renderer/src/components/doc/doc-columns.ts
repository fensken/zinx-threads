import { Node, mergeAttributes } from '@tiptap/core'

/**
 * Multi-column layout for the doc editor.
 *
 * Two nodes: a `columnBlock` container holding two or more `column` children, each of which
 * holds ordinary blocks. Both are `isolating`, so backspacing at the start of a column can't
 * silently merge it into the previous one and collapse the layout.
 *
 * The number of columns is NOT an attribute — it is simply how many `column` children exist.
 * CSS uses `grid-auto-flow: column`, which gives every child an equal track automatically,
 * so adding or removing one needs no attribute to stay in sync.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    columnBlock: {
      /** Insert a row of `count` equal columns, each starting with a paragraph. */
      setColumns: (count: number) => ReturnType
    }
  }
}

export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,

  parseHTML() {
    return [{ tag: 'div[data-column]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-column': '', class: 'zinx-column' }), 0]
  }
})

export const ColumnBlock = Node.create({
  name: 'columnBlock',
  group: 'block',
  content: 'column+',
  isolating: true,
  draggable: true,

  parseHTML() {
    return [{ tag: 'div[data-column-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-column-block': '', class: 'zinx-columns' }),
      0
    ]
  },

  addCommands() {
    return {
      setColumns:
        (count: number) =>
        ({ chain }) => {
          const columns = Array.from({ length: Math.max(2, count) }, () => ({
            type: Column.name,
            content: [{ type: 'paragraph' }]
          }))
          return (
            chain()
              .insertContent({ type: this.name, content: columns })
              // Land the caret in the first column rather than after the whole block.
              .focus()
              .run()
          )
        }
    }
  }
})
