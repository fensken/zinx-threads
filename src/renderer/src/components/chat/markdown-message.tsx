import { memo } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { MentionPill } from '@renderer/components/chat/mention-pill'
import { isMentionHref } from '@renderer/lib/mention'
import { platform } from '@renderer/lib/platform'
import { cn } from '@renderer/lib/utils'

/** react-markdown strips any scheme it doesn't recognise, which would gut our
 *  `zinx://` mention links. Allow exactly that scheme through; everything else
 *  keeps the library's default (http/https/mailto/tel/relative) sanitising. */
function urlTransform(url: string): string {
  return isMentionHref(url) ? url : defaultUrlTransform(url)
}

/** react-markdown hands link children as a node array; mentions only ever hold
 *  their own label text. */
function childText(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(childText).join('')
  return ''
}

/** Renders a message body (Markdown, as produced by `ChatComposer`) — GFM +
 *  single-newline line breaks, mirroring `_zinx`'s renderer. Links open
 *  externally through the platform layer (never navigate the app window).
 *
 *  `edited` appends a muted "(edited)" *inline* after the last paragraph (the
 *  arbitrary variant makes that trailing `<p>` inline so the tag doesn't wrap
 *  onto its own line), matching Slack/Discord. */
/** `memo`'d because `react-markdown` re-parses the Markdown on every render (no
 *  internal memo), and the message list re-renders each row on the 30s `useNow()` tick
 *  and on any workspace-directory change. The props are just primitives, so a shallow
 *  compare skips the re-parse whenever the body/`edited` flag is unchanged — which is
 *  the common case for every row but the one being edited. */
export const MarkdownMessage = memo(function MarkdownMessage({
  content,
  edited
}: {
  content: string
  edited?: boolean
}): React.JSX.Element {
  return (
    <div
      className={cn(
        'text-[0.9375rem] leading-[1.45] break-words text-foreground/90',
        edited && '[&>p:last-child]:inline'
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        urlTransform={urlTransform}
        // No raw HTML plugin → user content can't inject markup.
        components={{
          p: ({ children }) => <p className="my-0.5 first:mt-0 last:mb-0">{children}</p>,
          // Mentions are stored as links with a private scheme (`lib/mention.ts`),
          // so they surface here rather than in a separate renderer plugin.
          a: ({ href, children }) =>
            isMentionHref(href) ? (
              <MentionPill href={href as string} fallbackLabel={childText(children)} />
            ) : (
              <a
                href={href}
                onClick={(event) => {
                  event.preventDefault()
                  if (href) platform.openExternal(href)
                }}
                className="text-primary hover:underline"
              >
                {children}
              </a>
            ),
          img: ({ src, alt }) =>
            typeof src === 'string' ? (
              <img src={src} alt={alt ?? ''} className="mt-1 max-h-64 rounded-lg" />
            ) : null,
          ul: ({ children }) => <ul className="my-1 list-disc pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-1 list-decimal pl-5">{children}</ol>,
          li: ({ children }) => <li className="my-0.5">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="my-1 border-l-2 border-border pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          pre: ({ children }) => (
            <pre className="no-scrollbar my-1.5 overflow-x-auto rounded-lg bg-muted p-3 text-[0.85em]">
              {children}
            </pre>
          ),
          // Fenced code carries a `language-*` class; inline code does not.
          code: ({ className, children }) =>
            className ? (
              <code className={className}>{children}</code>
            ) : (
              <code className="rounded bg-muted px-1 py-0.5 text-[0.85em]">{children}</code>
            ),
          hr: () => <hr className="my-2 border-border" />
        }}
      >
        {content}
      </ReactMarkdown>
      {edited ? (
        <span className="ml-1 align-baseline text-[11px] text-muted-foreground">(edited)</span>
      ) : null}
    </div>
  )
})
