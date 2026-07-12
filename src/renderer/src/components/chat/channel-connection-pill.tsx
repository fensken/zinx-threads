import { PlugsConnected } from '@phosphor-icons/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { Tip } from '@renderer/components/ui/tooltip'

/** The **single** cross-workspace connection control in the channel header (Slack
 *  Connect). Clicking it opens the connections dialog. States:
 *  - shared, host view → "Shared · N" (manage: invite / remove guests)
 *  - shared, guest view → "Shared from <host>" (view connected orgs / leave)
 *  - not shared, host owner/admin → "Share" (start sharing)
 *  - not shared, plain member / guest → nothing.
 *  There is deliberately no second share button elsewhere in the header. */
export function ChannelConnectionPill({
  channelId,
  canManage = false,
  onOpen
}: {
  channelId: Id<'channels'>
  /** Owner/admin of the HOST workspace — may start sharing an unshared channel. */
  canManage?: boolean
  onOpen?: () => void
}): React.JSX.Element | null {
  const conn = useQuery(api.sharedChannels.connection, { channelId })
  // Don't flash a "Share" affordance before we know the shared state.
  if (conn === undefined) return null

  const shared = conn?.isShared ?? false
  if (!shared && !canManage) return null

  const label = shared
    ? conn?.viaGuest
      ? `Shared from ${conn.ownerWorkspaceName}`
      : `Shared · ${conn?.guestCount ?? 0}`
    : 'Share'
  const tip = shared
    ? `Connected: ${conn?.workspaces.join(', ')}`
    : 'Share this channel with another workspace'

  return (
    <Tip label={tip}>
      <button
        type="button"
        onClick={onOpen}
        className="ml-1.5 hidden shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20 sm:inline-flex"
      >
        <PlugsConnected className="size-3" weight="bold" />
        {label}
      </button>
    </Tip>
  )
}
