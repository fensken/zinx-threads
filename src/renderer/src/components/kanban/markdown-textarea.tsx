import { useState } from 'react'
import { Eye, MarkdownLogo, PencilSimple } from '@phosphor-icons/react'

import { cn } from '@renderer/lib/utils'

/** A Write/Preview description field with a markdown toolbar + char count —
 *  ported from the zinx-os MarkdownTextarea (without the Convex @/# autocomplete;
 *  Preview shows the raw text). */
export function MarkdownTextarea({
  value,
  onChange,
  placeholder = 'Write something…',
  maxLength = 2000,
  rows = 4,
  id
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  maxLength?: number
  rows?: number
  id?: string
}): React.JSX.Element {
  const [tab, setTab] = useState<'write' | 'preview'>(value.trim().length > 0 ? 'preview' : 'write')
  const overLimit = value.length > maxLength * 0.9

  return (
    <div className="flex flex-col rounded-lg border border-input bg-transparent transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
      <div className="flex items-center gap-1 px-2 pt-1">
        <TabButton active={tab === 'write'} onClick={() => setTab('write')}>
          <PencilSimple className="size-3.5" weight="duotone" />
          Write
        </TabButton>
        <TabButton active={tab === 'preview'} onClick={() => setTab('preview')}>
          <Eye className="size-3.5" weight="duotone" />
          Preview
        </TabButton>
      </div>

      {tab === 'write' ? (
        <textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          rows={rows}
          className="w-full resize-none bg-transparent px-2.5 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground"
        />
      ) : (
        <div className="min-h-24 px-2.5 py-2">
          {value.trim().length > 0 ? (
            <div className="text-sm leading-6 whitespace-pre-wrap">{value}</div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No content.</p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-input px-2.5 py-1.5">
        <MarkdownLogo
          className="size-4 text-primary"
          weight="duotone"
          aria-label="Markdown supported"
        />
        <span className="hidden text-xs text-muted-foreground sm:inline">Markdown supported</span>
        <span
          className={cn(
            'ml-auto text-xs tabular-nums',
            overLimit ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          {value.length.toLocaleString()}/{maxLength.toLocaleString()}
        </span>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 border-b-2 px-2 py-1.5 text-sm font-medium transition-colors',
        active
          ? 'border-primary text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}
