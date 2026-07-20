import { useState } from 'react'
import { useConvex, useMutation } from 'convex/react'
import { toast } from 'sonner'
import { DownloadSimple, ShieldCheck } from '@phosphor-icons/react'
import { api } from '@convex/_generated/api'
import type { Id } from '@convex/_generated/dataModel'
import { Button } from '@renderer/components/ui/button'
import { Spinner } from '@renderer/components/ui/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { errorMessage } from '@renderer/lib/convex-error'

/** Retention options — value is the day count as a string ('0' = keep everything). Only
 *  the human labels are ever shown (the id/label rule). */
const RETENTION_OPTIONS: Record<string, string> = {
  '0': 'Keep everything',
  '30': '30 days',
  '60': '60 days',
  '90': '90 days',
  '180': '180 days',
  '365': '1 year'
}

const EXPORT_PAGE = 200

/**
 * Workspace settings → **Compliance** (owner/admin). Two enterprise controls:
 * a message-retention policy (a daily cron hard-deletes older channel messages), and an
 * eDiscovery export that walks every channel to a downloadable JSON. DMs are excluded
 * from both — a workspace policy governs the team's channels, not private conversations.
 */
export function ComplianceTab({
  workspaceId,
  retentionDays
}: {
  workspaceId: Id<'workspaces'>
  retentionDays?: number
}): React.JSX.Element {
  const convex = useConvex()
  const setRetention = useMutation(api.workspaces.setRetention)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState<{ done: number } | null>(null)

  const current = retentionDays && retentionDays > 0 ? String(retentionDays) : '0'

  const changeRetention = async (value: string): Promise<void> => {
    setSaving(true)
    try {
      await setRetention({ workspaceId, days: Number(value) })
      toast.success(value === '0' ? 'Retention disabled' : `Retention set to ${value} days`)
    } catch (err) {
      console.error(err)
      toast.error(errorMessage(err, 'Could not update the retention policy'))
    } finally {
      setSaving(false)
    }
  }

  const runExport = async (): Promise<void> => {
    setExporting({ done: 0 })
    try {
      const meta = await convex.query(api.compliance.exportMetadata, { workspaceId })
      const messages: Array<Record<string, unknown>> = []
      for (const channel of meta.channels) {
        let cursor: string | null = null
        // Walk every page of this channel's messages.
        for (;;) {
          const page = await convex.query(api.compliance.exportMessages, {
            channelId: channel.id as Id<'channels'>,
            paginationOpts: { numItems: EXPORT_PAGE, cursor }
          })
          messages.push(...page.page)
          setExporting({ done: messages.length })
          if (page.isDone) break
          cursor = page.continueCursor
        }
      }
      const payload = {
        workspace: meta.workspace,
        exportedAt: new Date(meta.exportedAt).toISOString(),
        members: meta.members,
        channels: meta.channels,
        messageCount: messages.length,
        messages
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = `${meta.workspace.slug || 'workspace'}-export.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(objectUrl)
      toast.success(`Exported ${messages.length} messages`)
    } catch (err) {
      console.error(err)
      toast.error(errorMessage(err, 'Export failed'))
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-primary" weight="fill" />
          <h3 className="text-sm font-semibold">Compliance</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Retention and eDiscovery controls for this workspace. Direct messages are excluded from
          both.
        </p>
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase">Message retention</h4>
        <p className="text-sm text-muted-foreground">
          Automatically delete channel messages older than the selected age. Runs daily and cannot
          be undone.
        </p>
        <div className="flex items-center gap-2">
          <div className="w-56">
            <Select
              value={current}
              onValueChange={(value) => void changeRetention(value ?? '0')}
              items={RETENTION_OPTIONS}
              disabled={saving}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(RETENTION_OPTIONS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {saving ? <Spinner className="size-4 text-muted-foreground" /> : null}
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase">Data export</h4>
        <p className="text-sm text-muted-foreground">
          Download every channel message in this workspace as a JSON file, with members and
          channels, for legal hold or audit.
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={exporting !== null}
          onClick={() => void runExport()}
        >
          {exporting !== null ? (
            <>
              <Spinner className="size-4" />
              Exporting… ({exporting.done})
            </>
          ) : (
            <>
              <DownloadSimple className="size-4" />
              Export workspace data
            </>
          )}
        </Button>
      </section>
    </div>
  )
}
