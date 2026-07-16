import { useEffect, useState } from 'react'
import { BRAND } from '@shared/brand'
import { useAction, useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { Copy, Check, Plus, Trash, Warning, Plugs } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Spinner } from '@renderer/components/ui/spinner'
import { ConfirmDialog } from '@renderer/components/common/confirm-dialog'
import { copyToClipboard } from '@renderer/lib/clipboard'
import { errorMessage } from '@renderer/lib/convex-error'
import { cn } from '@renderer/lib/utils'
import { toast } from 'sonner'

/** The MCP endpoint lives on the Convex `.site` domain (HTTP actions), not the `.cloud`
 *  one the app's realtime queries use. Derived from the same env so it's always the right
 *  deployment. */
const MCP_URL = (import.meta.env.VITE_CONVEX_SITE_URL ?? '').replace(/\/$/, '') + '/mcp'

/**
 * Settings → Developers: personal access tokens for the MCP connector.
 *
 * A token is shown **once**, at creation — after that we only ever have its hash, so the row
 * shows a label + a preview, never the secret. This is where a user gets the credentials the
 * `/docs` page tells Claude/ChatGPT to use.
 */
export function DeveloperSettings(): React.JSX.Element {
  const tokens = useQuery(api.mcp.listTokens, {})
  const createToken = useAction(api.mcp.createToken)
  const revokeToken = useMutation(api.mcp.revokeToken)

  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [fresh, setFresh] = useState<{ token: string; name: string } | null>(null)
  const [revokeId, setRevokeId] = useState<Id<'apiTokens'> | null>(null)

  const create = async (): Promise<void> => {
    const label = name.trim()
    if (!label) return
    setCreating(true)
    try {
      const result = await createToken({ name: label })
      setFresh({ token: result.token, name: result.name })
      setName('')
    } catch (err) {
      toast.error(errorMessage(err, 'Could not create token'))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* What this is + where to point an AI. */}
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <Plugs className="size-5 text-primary" />
          <h3 className="text-sm font-semibold">Connect an AI (MCP)</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          {BRAND.productName} speaks the Model Context Protocol, so Claude, ChatGPT and other AI
          tools can read your channels and search your messages on your behalf. In Claude or
          ChatGPT, add a custom connector with this URL — you’ll sign in and approve access, no
          token needed. The access tokens below are for the MCP Inspector or scripts.
        </p>
        <CopyField label="MCP server URL" value={MCP_URL} />
        <a
          href="/docs"
          target="_blank"
          rel="noreferrer"
          className="inline-block text-sm font-medium text-primary hover:underline"
        >
          Read the connection guide →
        </a>
      </section>

      {/* Create. */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Access tokens</h3>
          <p className="text-xs text-muted-foreground">
            A token acts as you — it can see exactly what you can, and nothing more.
          </p>
        </div>

        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void create()}
            placeholder="Token name (e.g. Claude, ChatGPT)"
            maxLength={60}
          />
          <Button type="button" disabled={!name.trim() || creating} onClick={() => void create()}>
            {creating ? <Spinner className="size-4" /> : <Plus className="size-4" />}
            Create
          </Button>
        </div>

        {/* The one-time reveal. */}
        {fresh ? (
          <FreshToken token={fresh.token} name={fresh.name} onDone={() => setFresh(null)} />
        ) : null}

        {/* List. */}
        {tokens === undefined ? (
          <div className="flex min-h-16 items-center justify-center">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        ) : tokens.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No tokens yet. Create one to connect an AI.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {tokens.map((token) => (
              <li key={token._id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{token.name}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {token.preview}…
                    {token.lastUsedAt
                      ? ` · last used ${new Date(token.lastUsedAt).toLocaleDateString()}`
                      : ' · never used'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Revoke ${token.name}`}
                  onClick={() => setRevokeId(token._id)}
                >
                  <Trash className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={revokeId !== null}
        onOpenChange={(open) => !open && setRevokeId(null)}
        title="Revoke this token?"
        description="Any AI using it loses access immediately. This can't be undone — you'll need to create a new token to reconnect."
        confirmLabel="Revoke"
        onConfirm={async () => {
          if (revokeId) await revokeToken({ tokenId: revokeId })
        }}
      />
    </div>
  )
}

/** The token, shown once. Copy it now — after this dialog closes it's gone (we only kept a
 *  hash). A prominent warning, because there's no "show again". */
function FreshToken({
  token,
  name,
  onDone
}: {
  token: string
  name: string
  onDone: () => void
}): React.JSX.Element {
  return (
    <div className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Warning className="size-4 text-primary" weight="fill" />
        Copy your token now — you won’t see “{name}” again.
      </div>
      <CopyField label="" value={token} mono autoCopy />
      <Button type="button" variant="outline" size="sm" onClick={onDone}>
        <Check className="size-4" />
        Done
      </Button>
    </div>
  )
}

/** A read-only value with a copy button (URLs, tokens). */
function CopyField({
  label,
  value,
  mono,
  autoCopy
}: {
  label: string
  value: string
  mono?: boolean
  autoCopy?: boolean
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copy = async (): Promise<void> => {
    const ok = await copyToClipboard(value)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }
  }
  // Copy the freshly-minted token to the clipboard the moment it appears — the safest
  // default, so a user who reads the warning and closes too fast still has it. This writes
  // silently (no "Copied" flash) so it doesn't set state from the effect; the button below is
  // there for an explicit, acknowledged copy.
  useEffect(() => {
    if (autoCopy) void copyToClipboard(value)
  }, [autoCopy, value])

  return (
    <div className="space-y-1">
      {label ? <p className="text-xs font-medium text-muted-foreground">{label}</p> : null}
      <div className="flex items-center gap-2">
        <code
          className={cn(
            'min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs',
            mono && 'font-mono'
          )}
        >
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
    </div>
  )
}
