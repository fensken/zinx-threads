import { useState } from 'react'
import {
  ArrowBendUpLeft,
  Check,
  Copy,
  DotsThreeOutline,
  PencilSimple,
  PushPin,
  Scribble,
  Smiley,
  Trash
} from '@phosphor-icons/react'
import { EmojiPickerPanel } from '@renderer/components/pickers/emoji-picker'
import { Button } from '@renderer/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { cn } from '@renderer/lib/utils'

/** Floating hover toolbar on a message row (mirrors `_zinx`'s `MessageActions`):
 *  copy · react · reply · thread · edit (author) · more ▸ pin/delete.
 *
 *  It stays mounted while either popover is open, so the bar doesn't vanish out
 *  from under the pointer. */
export function MessageActions({
  isAuthor,
  canDelete,
  canPin,
  isPinned,
  hasThread,
  onCopy,
  onReact,
  onReply,
  onEdit,
  onPin,
  onDelete,
  onThread,
  reactOpen,
  setReactOpen
}: {
  isAuthor: boolean
  canDelete: boolean
  /** Owner/admin only (moderation), mirroring `_zinx`. */
  canPin: boolean
  isPinned: boolean
  /** Flips the thread button between "start" and "open". */
  hasThread?: boolean
  onCopy: () => void
  onReact: (emoji: string) => void
  /** Absent in a read-only channel — the reply composer is the same composer, so a
   *  Reply button there would open a box that can't send. Same rule as `onThread`. */
  onReply?: () => void
  onEdit: () => void
  onPin: () => void
  onDelete: () => void
  /** Omitted inside a thread panel — threads don't nest. */
  onThread?: () => void
  /** Controlled so the reaction picker can also be opened from the `+` pill. */
  reactOpen: boolean
  setReactOpen: (open: boolean) => void
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const copy = (): void => {
    onCopy()
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const pinned = reactOpen || menuOpen

  return (
    <div
      className={cn(
        'absolute -top-3 right-3 z-10 flex items-center rounded-md border bg-popover shadow-sm transition-opacity',
        pinned ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
      )}
    >
      <ActionButton label={copied ? 'Copied!' : 'Copy text'} onClick={copy}>
        {copied ? (
          <Check className="size-4 text-primary" weight="bold" />
        ) : (
          <Copy className="size-4" />
        )}
      </ActionButton>

      <Popover open={reactOpen} onOpenChange={setReactOpen}>
        <PopoverTrigger
          title="Add a reaction"
          aria-label="Add a reaction"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Smiley className="size-4" />
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={8}
          // The picker brings its own surface — strip the popover's bg/ring/shadow
          // (the base class sets `ring-1`, which showed as an empty framed box).
          className="w-auto rounded-none border-none bg-transparent p-0 shadow-none ring-0"
        >
          <EmojiPickerPanel
            onSelect={(emoji) => {
              onReact(emoji)
              setReactOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>

      {onReply ? (
        <ActionButton label="Reply" onClick={onReply}>
          <ArrowBendUpLeft className="size-4" />
        </ActionButton>
      ) : null}

      {onThread ? (
        <ActionButton label={hasThread ? 'Open thread' : 'Start a thread'} onClick={onThread}>
          {/* `bold`, not `fill`: Scribble is a line glyph, so a fill weight barely
              differs from regular — weight is what reads as "this already has one". */}
          <Scribble className="size-4" weight={hasThread ? 'bold' : 'regular'} />
        </ActionButton>
      ) : null}

      {isAuthor ? (
        <ActionButton label="Edit message" onClick={onEdit}>
          <PencilSimple className="size-4" />
        </ActionButton>
      ) : null}

      {canPin || canDelete ? (
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger
            title="More"
            aria-label="More actions"
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <DotsThreeOutline className="size-4" weight="fill" />
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-44 p-1">
            {canPin ? (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => {
                  setMenuOpen(false)
                  onPin()
                }}
              >
                <PushPin className="size-4" weight={isPinned ? 'fill' : 'regular'} />
                {isPinned ? 'Unpin message' : 'Pin message'}
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => {
                  setMenuOpen(false)
                  onDelete()
                }}
              >
                <Trash className="size-4" />
                Delete message
              </Button>
            ) : null}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )
}

function ActionButton({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  )
}
