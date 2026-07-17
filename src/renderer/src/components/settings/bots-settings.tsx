import { useState } from 'react'
import { useAction, useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { toast } from 'sonner'
import { Check, Copy, Plugs, Plus, Robot, Trash, Warning } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Doc, Id } from '@convex/_generated/dataModel'
import { Avatar, FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Spinner } from '@renderer/components/ui/spinner'
import { ConfirmDialog } from '@renderer/components/common/confirm-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { ChannelKindIcon } from '@renderer/components/chat/channel-kind-icon'
import { copyToClipboard } from '@renderer/lib/clipboard'
import { initialsOf } from '@renderer/lib/initials'
import { avatarImageFor } from '@renderer/lib/app-logo'
import { errorMessage } from '@renderer/lib/convex-error'
import { cn } from '@renderer/lib/utils'

/** Fire a mutation/action, surface its `ConvexError` as a toast. */
async function run<T>(action: Promise<T>, fallback: string): Promise<T | undefined> {
  try {
    return await action
  } catch (err) {
    console.error(err)
    toast.error(errorMessage(err, fallback))
    return undefined
  }
}

/**
 * Workspace settings → **Bots**. Create automation members, copy their token once, and give
 * them Slack-style incoming webhooks pointed at a channel. Owner/admin only for the writes;
 * everyone sees the list (a bot is a visible member).
 */
export function BotsTab({
  workspace,
  canManage
}: {
  workspace: Doc<'workspaces'>
  canManage: boolean
}): React.JSX.Element {
  const bots = useQuery(api.bots.listByWorkspace, { workspaceId: workspace._id })
  const createBot = useAction(api.bots.create)
  const removeBot = useMutation(api.bots.remove)

  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null)
  const [removeId, setRemoveId] = useState<Id<'bots'> | null>(null)

  const create = async (): Promise<void> => {
    const label = name.trim()
    if (!label) return
    setCreating(true)
    const result = await run(
      createBot({ workspaceId: workspace._id, name: label }),
      'Could not create bot'
    )
    setCreating(false)
    if (result) {
      setFresh({ token: result.token, name: result.name })
      setName('')
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Robot className="size-5 text-primary" weight="fill" />
          <h3 className="text-sm font-semibold">Bots</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          A bot is an automation that posts as a member of this workspace. Give it a token to drive
          the API, or an incoming webhook so a service (CI, alerts, GitHub) can post with a single
          HTTP request. A bot can only reach channels it can post in.
        </p>
        <a
          href="/docs#bots"
          target="_blank"
          rel="noreferrer"
          className="inline-block text-sm font-medium text-primary hover:underline"
        >
          Read the bot guide →
        </a>
      </section>

      {canManage ? (
        <section className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void create()}
              placeholder="Bot name (e.g. Deploy Bot)"
              maxLength={60}
            />
            <Button type="button" disabled={!name.trim() || creating} onClick={() => void create()}>
              {creating ? <Spinner className="size-4" /> : <Plus className="size-4" />}
              Create bot
            </Button>
          </div>
          {fresh ? (
            <FreshToken
              label={`${fresh.name}'s token`}
              value={fresh.token}
              note="Use it as an API bearer token. You won’t see it again."
              onDone={() => setFresh(null)}
            />
          ) : null}
        </section>
      ) : null}

      <section className="space-y-2">
        {bots === undefined ? (
          <div className="flex min-h-20 items-center justify-center">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        ) : bots.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            No bots yet.{canManage ? ' Create one above.' : ''}
          </p>
        ) : (
          <ul className="space-y-2">
            {bots.map((bot) => (
              <BotCard
                key={bot._id}
                bot={bot}
                workspace={workspace}
                canManage={canManage}
                onRemove={() => setRemoveId(bot._id)}
              />
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={removeId !== null}
        onOpenChange={(open) => !open && setRemoveId(null)}
        title="Remove this bot?"
        description="Its token and webhooks stop working immediately. Messages it already posted are kept."
        confirmLabel="Remove bot"
        onConfirm={async () => {
          if (removeId) await removeBot({ botId: removeId })
        }}
      />
    </div>
  )
}

type BotSummary = NonNullable<ReturnType<typeof useQuery<typeof api.bots.listByWorkspace>>>[number]

function BotCard({
  bot,
  workspace,
  canManage,
  onRemove
}: {
  bot: BotSummary
  workspace: Doc<'workspaces'>
  canManage: boolean
  onRemove: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <li className="rounded-lg border">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <Avatar
          initials={initialsOf(bot.name)}
          color={bot.color ?? FALLBACK_AVATAR_COLOR}
          image={avatarImageFor(bot.avatarUrl, true)}
          className="size-8"
        />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 truncate text-sm font-medium">
            <Robot className="size-3.5 shrink-0 text-info" weight="fill" />
            {bot.name}
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {bot.tokenPreview ?? 'zt_…'}… ·{' '}
            {bot.webhookCount === 1 ? '1 webhook' : `${bot.webhookCount} webhooks`}
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((v) => !v)}>
          <Plugs className="size-4" />
          Webhooks
        </Button>
        {canManage ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${bot.name}`}
            onClick={onRemove}
          >
            <Trash className="size-4" />
          </Button>
        ) : null}
      </div>
      {open ? <BotWebhooks bot={bot} workspace={workspace} canManage={canManage} /> : null}
    </li>
  )
}

function BotWebhooks({
  bot,
  workspace,
  canManage
}: {
  bot: BotSummary
  workspace: Doc<'workspaces'>
  canManage: boolean
}): React.JSX.Element {
  const webhooks = useQuery(api.bots.listWebhooks, { botId: bot._id })
  const channels = useQuery(api.channels.listBySlug, { slug: workspace.slug })
  const createWebhook = useAction(api.bots.createWebhook)
  const removeWebhook = useMutation(api.bots.removeWebhook)

  const [channelId, setChannelId] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [freshUrl, setFreshUrl] = useState<string | null>(null)
  const [removeId, setRemoveId] = useState<Id<'incomingWebhooks'> | null>(null)

  // Only chat channels the bot could post in are valid targets.
  const postable = (channels ?? []).filter((c) => c.kind === 'chat' && c.canPost)
  // Plain names — the trigger shows the channel-kind icon, not a text `#`.
  const channelItems = Object.fromEntries(postable.map((c) => [c._id, c.name]))

  const add = async (): Promise<void> => {
    if (!channelId) return
    setBusy(true)
    const result = await run(
      createWebhook({ botId: bot._id, channelId: channelId as Id<'channels'> }),
      'Could not create webhook'
    )
    setBusy(false)
    if (result) {
      setFreshUrl(result.url)
      setChannelId('')
    }
  }

  return (
    <div className="space-y-3 border-t bg-muted/20 px-3 py-3">
      {canManage ? (
        <div className="flex gap-2">
          <Select
            value={channelId}
            onValueChange={(value) => setChannelId(value ?? '')}
            items={channelItems}
          >
            <SelectTrigger className="h-9 flex-1">
              <ChannelKindIcon kind="chat" className="size-3.5 text-muted-foreground" />
              <SelectValue placeholder="Post to channel…" />
            </SelectTrigger>
            <SelectContent>
              {postable.map((c) => (
                <SelectItem key={c._id} value={c._id}>
                  <span className="flex items-center gap-1.5">
                    <ChannelKindIcon kind={c.kind} className="size-3.5 text-muted-foreground" />
                    {c.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="button" size="sm" disabled={!channelId || busy} onClick={() => void add()}>
            {busy ? <Spinner className="size-4" /> : <Plus className="size-4" />}
            Add webhook
          </Button>
        </div>
      ) : null}

      {freshUrl ? (
        <FreshToken
          label="Webhook URL"
          value={freshUrl}
          note="POST JSON { text } here to post as this bot. You won’t see it again."
          onDone={() => setFreshUrl(null)}
        />
      ) : null}

      {webhooks === undefined ? (
        <div className="flex min-h-10 items-center justify-center">
          <Spinner className="size-4 text-muted-foreground" />
        </div>
      ) : webhooks.length === 0 ? (
        <p className="text-xs text-muted-foreground">No webhooks yet.</p>
      ) : (
        <ul className="space-y-1">
          {webhooks.map((hook) => (
            <li key={hook._id} className="flex items-center gap-2 text-xs">
              <ChannelKindIcon kind="chat" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="font-medium">#{hook.channelName}</span>
              <span className="font-mono text-muted-foreground">{hook.preview}…</span>
              <span className="text-muted-foreground">
                {hook.lastUsedAt
                  ? `· fired ${new Date(hook.lastUsedAt).toLocaleDateString()}`
                  : '· never fired'}
              </span>
              {canManage ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="ml-auto size-6 text-muted-foreground hover:text-destructive"
                  aria-label="Delete webhook"
                  onClick={() => setRemoveId(hook._id)}
                >
                  <Trash className="size-3.5" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={removeId !== null}
        onOpenChange={(open) => !open && setRemoveId(null)}
        title="Delete this webhook?"
        description="The URL stops working immediately. This can't be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (removeId) await removeWebhook({ webhookId: removeId })
        }}
      />
    </div>
  )
}

/** A one-time secret reveal (token or webhook URL), auto-copied on show. */
function FreshToken({
  label,
  value,
  note,
  onDone
}: {
  label: string
  value: string
  note: string
  onDone: () => void
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    if (await copyToClipboard(value)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }
  }
  return (
    <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <p className="flex items-center gap-2 text-xs font-medium">
        <Warning className="size-4 text-primary" weight="fill" />
        {label} — copy it now. {note}
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-2.5 py-1.5 font-mono text-xs">
          {value}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => void copy()}
        >
          {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onDone}>
        <Check className={cn('size-4')} />
        Done
      </Button>
    </div>
  )
}
