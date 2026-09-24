import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps
} from '@tiptap/react'
import { createLowlight } from 'lowlight'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdown from 'highlight.js/lib/languages/markdown'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { CaretDown } from '@phosphor-icons/react'

import { Button } from '@renderer/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'

/**
 * The doc editor's syntax-highlighted code block.
 *
 * A **curated** language set, not highlight.js's `common`: `common` bundles ~37 grammars,
 * and these are all loaded eagerly by whoever imports this module. The doc editor is
 * already its own lazy chunk, so the cost is paid only by someone who opens a doc — but
 * there's still no reason to ship a Lisp parser for it. These cover effectively everything
 * posted in practice.
 */
const lowlight = createLowlight({
  bash,
  c,
  cpp,
  csharp,
  css,
  go,
  java,
  javascript,
  json,
  kotlin,
  markdown,
  php,
  python,
  ruby,
  rust,
  scss,
  shell,
  sql,
  swift,
  typescript,
  xml, // also covers HTML
  yaml
})

/** Picker entries — `value` is the language stored on the node. */
const CODE_LANGUAGES: { value: string; label: string }[] = [
  { value: '', label: 'Auto' },
  { value: 'bash', label: 'Bash' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'csharp', label: 'C#' },
  { value: 'css', label: 'CSS' },
  { value: 'go', label: 'Go' },
  { value: 'java', label: 'Java' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'json', label: 'JSON' },
  { value: 'kotlin', label: 'Kotlin' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'php', label: 'PHP' },
  { value: 'python', label: 'Python' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'rust', label: 'Rust' },
  { value: 'scss', label: 'SCSS' },
  { value: 'shell', label: 'Shell' },
  { value: 'sql', label: 'SQL' },
  { value: 'swift', label: 'Swift' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'xml', label: 'HTML / XML' },
  { value: 'yaml', label: 'YAML' }
]

/** `CodeBlockLowlight` plus an in-block language picker. */
export const DocCodeBlock = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView)
  }
}).configure({ lowlight })

function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps): React.JSX.Element {
  const language = String(node.attrs.language ?? '')
  const active = CODE_LANGUAGES.find((entry) => entry.value === language) ?? CODE_LANGUAGES[0]

  return (
    <NodeViewWrapper className="zinx-code-block">
      {editor.isEditable ? (
        <div className="zinx-code-block-bar" contentEditable={false}>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-xs font-normal"
                />
              }
            >
              {/* The LABEL, never the stored value — `typescript` is an id, not a name. */}
              {active.label}
              <CaretDown className="size-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 min-w-40 overflow-y-auto">
              {CODE_LANGUAGES.map((entry) => (
                <DropdownMenuItem
                  key={entry.value || 'auto'}
                  onClick={() => updateAttributes({ language: entry.value || null })}
                >
                  {entry.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
      <pre>
        {/* Explicit generic: `as` is typed `NoInfer<T>`, so without it T stays at its
            "div" default — and a <div> inside <pre> is invalid HTML. */}
        <NodeViewContent<'code'> as="code" />
      </pre>
    </NodeViewWrapper>
  )
}
