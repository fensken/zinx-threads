import { useRef, useState } from 'react'
import {
  CaretRight,
  Check,
  Copy,
  PencilSimple,
  SignOut,
  Smiley,
  WifiSlash
} from '@phosphor-icons/react'
import { Avatar } from '@renderer/components/common/avatar'
import { StatusGlyph } from '@renderer/components/common/status-glyph'
import { EmojiPicker } from '@renderer/components/pickers/emoji-picker'
import {
  STATUS_LABEL,
  USER_STATUSES,
  presenceForStatus,
  type UserStatus
} from '@renderer/lib/user-status'
import { cn } from '@renderer/lib/utils'
import { copyToClipboard } from '@renderer/lib/clipboard'

export interface UserMenuProps {
  name: string
  subtitle: string
  initials: string
  color: string
  image?: string | null
  userId: string
  status: UserStatus
  statusEmoji?: string
  statusText?: string
  onSetStatus: (status: UserStatus) => void
  onSetCustomStatus: (emoji: string | undefined, text: string) => void
  onEditProfile: () => void
  onSignOut?: () => void
  /** Jump to the local, no-account offline workspaces. */
  onOfflineWorkspaces?: () => void
  onClose: () => void
  /** Lets the parent popover stay open while the emoji picker overlay is up. */
  onEmojiOpenChange?: (open: boolean) => void
  /** Which side the presence submenu flies out to. Defaults to `right` (the sidebar user
   *  panel, anchored bottom-left, has room there); pass `left` when the menu itself is
   *  anchored to the right edge (the `/workspaces` header), or the submenu runs off-screen. */
  submenuSide?: 'left' | 'right'
}

export function UserMenu(props: UserMenuProps): React.JSX.Element {
  const {
    name,
    subtitle,
    initials,
    color,
    image,
    userId,
    status,
    statusEmoji,
    statusText,
    onSetStatus,
    onSetCustomStatus,
    onEditProfile,
    onSignOut,
    onOfflineWorkspaces,
    onClose,
    onEmojiOpenChange,
    submenuSide = 'right'
  } = props

  const [editing, setEditing] = useState(false)
  const [draftEmoji, setDraftEmoji] = useState<string | undefined>(statusEmoji)
  const [draftText, setDraftText] = useState(statusText ?? '')
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  // The presence submenu opens on HOVER (Discord-style), with a short close delay so
  // moving the cursor across the small gap into the flyout doesn't dismiss it.
  const statusTimer = useRef<number | null>(null)
  const openStatus = (): void => {
    if (statusTimer.current) {
      window.clearTimeout(statusTimer.current)
      statusTimer.current = null
    }
    setStatusOpen(true)
  }
  const closeStatusSoon = (): void => {
    if (statusTimer.current) window.clearTimeout(statusTimer.current)
    statusTimer.current = window.setTimeout(() => setStatusOpen(false), 160)
  }

  const openEmoji = (): void => {
    setEmojiOpen(true)
    onEmojiOpenChange?.(true)
  }
  const closeEmoji = (): void => {
    setEmojiOpen(false)
    // Clear the parent's close-guard on the next tick, so the very click that
    // dismisses the (portaled, outside-the-popover) picker doesn't also close
    // the menu popover.
    setTimeout(() => onEmojiOpenChange?.(false), 0)
  }
  const startEditing = (): void => {
    setDraftEmoji(statusEmoji)
    setDraftText(statusText ?? '')
    setStatusOpen(false)
    setEditing(true)
  }
  const saveStatus = (): void => {
    onSetCustomStatus(draftEmoji, draftText)
    setEditing(false)
  }
  const clearStatus = (): void => {
    setDraftEmoji(undefined)
    setDraftText('')
    onSetCustomStatus(undefined, '')
    setEditing(false)
  }
  const copyId = (): void => {
    void copyToClipboard(userId).then((ok) => {
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const hasCustom = Boolean(statusEmoji || statusText)

  return (
    <div className="flex w-full flex-col">
      {/* Identity — clean, no banner (Slack-style). */}
      <div className="flex items-center gap-3 px-1.5 pt-1 pb-2">
        <Avatar
          initials={initials}
          color={color}
          image={image}
          presence={presenceForStatus(status)}
          ringClassName="ring-2 ring-popover"
          className="size-11"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{name}</div>
          <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
        </div>
      </div>

      {/* Custom status */}
      {editing ? (
        <div className="mb-1 rounded-lg border p-1.5">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Pick an emoji"
              onClick={openEmoji}
              className="flex size-8 shrink-0 items-center justify-center rounded-md text-lg hover:bg-accent"
            >
              {draftEmoji ?? <Smiley className="size-5 text-muted-foreground" />}
            </button>
            <input
              autoFocus
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveStatus()
                if (e.key === 'Escape') setEditing(false)
              }}
              maxLength={100}
              placeholder="What's your status?"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            <button
              type="button"
              aria-label="Save status"
              onClick={saveStatus}
              className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <Check className="size-4" weight="bold" />
            </button>
          </div>
          {hasCustom ? (
            <button
              type="button"
              onClick={clearStatus}
              className="mt-1 w-full px-1 py-0.5 text-left text-xs text-muted-foreground hover:text-foreground"
            >
              Clear status
            </button>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={startEditing}
          className="mb-1 flex w-full items-center gap-2 rounded-lg border bg-muted/40 px-2.5 py-2 text-sm transition-colors hover:bg-muted"
        >
          <span className="flex size-5 shrink-0 items-center justify-center text-base">
            {statusEmoji ?? <Smiley className="size-4 text-muted-foreground" />}
          </span>
          <span className={cn('flex-1 truncate text-left', !statusText && 'text-muted-foreground')}>
            {statusText || 'Set a custom status'}
          </span>
          {hasCustom ? <PencilSimple className="size-3.5 text-muted-foreground" /> : null}
        </button>
      )}

      <Divider />

      {/* Presence — a single row showing the current (static) status; the full
          set opens as a side flyout submenu (kept inside the popover DOM so
          clicks don't dismiss the outer popover). */}
      <div className="relative" onMouseEnter={openStatus} onMouseLeave={closeStatusSoon}>
        <button
          type="button"
          onClick={() => setStatusOpen((open) => !open)}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
            statusOpen ? 'bg-accent' : 'hover:bg-accent hover:text-foreground'
          )}
        >
          <StatusGlyph status={status} className="size-3.5" />
          <span className="flex-1">{STATUS_LABEL[status]}</span>
          <CaretRight className="size-3.5 text-muted-foreground" />
        </button>

        {statusOpen ? (
          <div
            className={cn(
              'absolute top-0 z-50 w-60 rounded-lg border bg-popover p-1 shadow-xl',
              submenuSide === 'left' ? 'right-full mr-1' : 'left-full ml-1'
            )}
            onMouseEnter={openStatus}
            onMouseLeave={closeStatusSoon}
          >
            {USER_STATUSES.map((option) => {
              const active = status === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    onSetStatus(option.id)
                    setStatusOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-start gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
                    active ? 'bg-accent font-medium' : 'hover:bg-accent hover:text-foreground'
                  )}
                >
                  <StatusGlyph status={option.id} className="mt-[3px] size-3.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block leading-5">{option.label}</span>
                    {option.description ? (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                  {active ? (
                    <Check className="mt-[3px] size-4 shrink-0 text-primary" weight="bold" />
                  ) : null}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      <Divider />

      <Row
        onClick={() => {
          onEditProfile()
          onClose()
        }}
      >
        <PencilSimple className="size-4 text-muted-foreground" />
        <span className="flex-1">Edit profile</span>
      </Row>
      <Row onClick={copyId}>
        {copied ? (
          <Check className="size-4 text-primary" weight="bold" />
        ) : (
          <Copy className="size-4 text-muted-foreground" />
        )}
        <span className="flex-1">{copied ? 'Copied!' : 'Copy user ID'}</span>
      </Row>

      {onOfflineWorkspaces ? (
        <Row
          onClick={() => {
            onOfflineWorkspaces()
            onClose()
          }}
        >
          <WifiSlash className="size-4 text-muted-foreground" />
          <span className="flex-1">Offline workspaces</span>
        </Row>
      ) : null}

      {onSignOut ? (
        <>
          <Divider />
          <Row
            destructive
            onClick={() => {
              onSignOut()
              onClose()
            }}
          >
            <SignOut className="size-4" />
            <span className="flex-1">Sign out</span>
          </Row>
        </>
      ) : null}

      {emojiOpen ? (
        <EmojiPicker
          onSelect={(emoji) => {
            setDraftEmoji(emoji)
            closeEmoji()
          }}
          onClose={closeEmoji}
        />
      ) : null}
    </div>
  )
}

function Row({
  children,
  onClick,
  active,
  destructive
}: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
  destructive?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
        destructive
          ? 'text-destructive hover:bg-destructive/10'
          : active
            ? 'bg-accent font-medium'
            : 'hover:bg-accent hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}

function Divider(): React.JSX.Element {
  return <div className="my-1 h-px bg-border" />
}
