import { useQuery } from 'convex-helpers/react/cache/hooks'
import { ChartBar, ChatText, Hash, UsersThree } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { Spinner } from '@renderer/components/ui/spinner'

/**
 * Workspace settings → **Analytics** (owner/admin). A "how is my team using this"
 * dashboard: member + channel makeup, message volume over the last 30 days, and the
 * most-active channels. Backed by `analytics.workspaceStats` (bounded scan — the
 * volume numbers are marked "+"" when the cap is hit, never silently truncated).
 */
export function AnalyticsTab({
  workspaceId
}: {
  workspaceId: Id<'workspaces'>
}): React.JSX.Element {
  const stats = useQuery(api.analytics.workspaceStats, { workspaceId })

  if (stats === undefined) {
    return (
      <div className="flex min-h-40 items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  const cap = stats.messages.capped ? '+' : ''

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <ChartBar className="size-5 text-primary" weight="fill" />
          <h3 className="text-sm font-semibold">Analytics</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Usage across this workspace. Message volume is measured over the last 30 days.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          Icon={UsersThree}
          label="Members"
          value={String(stats.members.total)}
          sub={`${stats.members.bots} bot${stats.members.bots === 1 ? '' : 's'}`}
        />
        <StatCard Icon={Hash} label="Channels" value={String(stats.channels.total)} />
        <StatCard
          Icon={ChatText}
          label="Messages · 7d"
          value={`${stats.messages.last7Days}${cap}`}
        />
        <StatCard
          Icon={ChatText}
          label="Active members"
          value={String(stats.messages.activeMembers)}
          sub="last 30 days"
        />
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase">
          Messages per day · last 30 days ({stats.messages.last30Days}
          {cap} total)
        </h4>
        <Sparkline series={stats.messages.dailySeries} />
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase">Members by role</h4>
          <Breakdown
            rows={[
              ['Owner', stats.members.byRole.owner],
              ['Admins', stats.members.byRole.admin],
              ['Members', stats.members.byRole.member],
              ['Guests', stats.members.byRole.guest]
            ]}
          />
        </div>
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase">
            Channels by kind
          </h4>
          <Breakdown rows={Object.entries(stats.channels.byKind).map(([k, n]) => [k, n])} />
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase">
          Most active channels
        </h4>
        {stats.topChannels.length === 0 ? (
          <p className="text-sm text-muted-foreground">No message activity yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {stats.topChannels.map((c) => (
              <li key={c.channelId} className="flex items-center gap-2 text-sm">
                <Hash className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="font-medium text-muted-foreground">
                  {c.count}
                  {stats.messages.capped ? '+' : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function StatCard({
  Icon,
  label,
  value,
  sub
}: {
  Icon: typeof ChartBar
  label: string
  value: string
  sub?: string
}): React.JSX.Element {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  )
}

/** A minimal inline bar chart — divs, no chart lib. Height is relative to the peak day. */
function Sparkline({ series }: { series: number[] }): React.JSX.Element {
  const peak = Math.max(1, ...series)
  return (
    <div className="flex h-24 items-end gap-0.5 rounded-lg border bg-card p-2">
      {series.map((value, index) => (
        <div
          key={index}
          className="flex-1 rounded-sm bg-primary/70"
          style={{ height: `${Math.max(2, (value / peak) * 100)}%` }}
          title={`${value} message${value === 1 ? '' : 's'}`}
        />
      ))}
    </div>
  )
}

function Breakdown({ rows }: { rows: Array<[string, number]> }): React.JSX.Element {
  return (
    <ul className="space-y-1 text-sm">
      {rows.map(([label, count]) => (
        <li key={label} className="flex items-center justify-between">
          <span className="capitalize text-muted-foreground">{label}</span>
          <span className="font-medium tabular-nums">{count}</span>
        </li>
      ))}
    </ul>
  )
}
