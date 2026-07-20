import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { toast } from 'sonner'
import { api } from '@convex/_generated/api'
import type { Doc, Id } from '@convex/_generated/dataModel'
import { errorMessage } from '@renderer/lib/convex-error'
import { useSaveStatus } from '@renderer/lib/use-save-status'
import { SaveStatus } from '@renderer/components/common/save-status'
import { DatabaseSkeleton } from '@renderer/components/common/skeletons'
import { DatabaseView } from './database-view'
import type { CellValue, DbField, DbMember, DbRecord, DbView } from './database-types'
import type { DbFieldType } from './database-types'

/**
 * A `database` channel (Airtable-style) — the ONLINE adapter. Subscribes to
 * `database.getByChannel` + the workspace members (for `user` fields), maps the Convex
 * docs to the presentational `id`-based shapes, and wires every edit to the `database.*`
 * mutations. The look lives in the shared `DatabaseView` (also used by the offline
 * adapter), so the two can't drift.
 */
export function RealDatabaseView({ channel }: { channel: Doc<'channels'> }): React.JSX.Element {
  const data = useQuery(api.database.getByChannel, { channelId: channel._id })
  const memberRows = useQuery(api.members.listByWorkspace, { workspaceId: channel.workspaceId })

  const createField = useMutation(api.database.createField)
  const updateFieldMut = useMutation(api.database.updateField)
  const deleteField = useMutation(api.database.deleteField)
  const createRecord = useMutation(api.database.createRecord)
  const updateCell = useMutation(api.database.updateCell)
  const deleteRecord = useMutation(api.database.deleteRecord)
  const updateViewMut = useMutation(api.database.updateView)
  const createView = useMutation(api.database.createView)
  const deleteViewMut = useMutation(api.database.deleteView)
  const importRows = useMutation(api.database.importRows)
  const { state: saveState, track } = useSaveStatus()

  if (data === undefined) {
    return <DatabaseSkeleton />
  }
  if (data === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        This table isn’t available.
      </div>
    )
  }

  const fields: DbField[] = data.fields.map((f) => ({
    id: f._id,
    name: f.name,
    type: f.type,
    options: f.options,
    order: f.order
  }))
  const records: DbRecord[] = data.records.map((r) => ({
    id: r._id,
    values: r.values,
    order: r.order
  }))
  const views: DbView[] = data.views.map((v) => ({
    id: v._id,
    name: v.name,
    type: v.type,
    config: v.config,
    order: v.order
  }))
  const members: DbMember[] = (memberRows ?? []).map((row) => ({
    userId: row.user._id as string,
    name: row.user.name,
    color: row.user.color,
    avatarUrl: row.user.avatarUrl
  }))

  const guard = async (promise: Promise<unknown>, fallback: string): Promise<void> => {
    try {
      // `track` drives the "Saving… / Saved" pill in the tab bar.
      await track(promise)
    } catch (err) {
      console.error(err)
      toast.error(errorMessage(err, fallback))
    }
  }

  return (
    <DatabaseView
      fields={fields}
      records={records}
      views={views}
      members={members}
      saveStatus={<SaveStatus state={saveState} />}
      onUpdateCell={(recordId, fieldId, value: CellValue) =>
        void guard(
          updateCell({ recordId: recordId as Id<'databaseRecords'>, fieldId, value }),
          'Could not update the cell'
        )
      }
      onAddRecord={(values) =>
        void guard(createRecord({ channelId: channel._id, values }), 'Could not add a record')
      }
      onDeleteRecord={(recordId) =>
        void guard(
          deleteRecord({ recordId: recordId as Id<'databaseRecords'> }),
          'Could not delete the record'
        )
      }
      onAddField={(input: { name: string; type: DbFieldType; options?: DbField['options'] }) =>
        void guard(
          createField({
            channelId: channel._id,
            name: input.name,
            type: input.type,
            options: input.options
          }),
          'Could not add the field'
        )
      }
      onUpdateField={(fieldId, input) =>
        void guard(
          updateFieldMut({
            fieldId: fieldId as Id<'databaseFields'>,
            name: input.name,
            type: input.type,
            options: input.options
          }),
          'Could not update the field'
        )
      }
      onDeleteField={(fieldId) =>
        void guard(
          deleteField({ fieldId: fieldId as Id<'databaseFields'> }),
          'Could not delete the field'
        )
      }
      onUpdateView={(viewId, config) =>
        void guard(
          updateViewMut({ viewId: viewId as Id<'databaseViews'>, config }),
          'Could not update the view'
        )
      }
      onAddView={(input) =>
        void guard(
          createView({ channelId: channel._id, name: input.name, type: input.type }),
          'Could not add the view'
        )
      }
      onRenameView={(viewId, name) =>
        void guard(
          updateViewMut({ viewId: viewId as Id<'databaseViews'>, name }),
          'Could not rename the view'
        )
      }
      onDeleteView={(viewId) =>
        void guard(
          deleteViewMut({ viewId: viewId as Id<'databaseViews'> }),
          'Could not delete the view'
        )
      }
      onImport={async (headers, rows) => {
        try {
          // Return the server's real {imported, skipped} so the grid's toast is honest about
          // rows dropped by the record cap.
          return (await track(importRows({ channelId: channel._id, headers, rows }))) as {
            imported: number
            skipped: number
          }
        } catch (err) {
          console.error(err)
          toast.error(errorMessage(err, 'Could not import the CSV'))
          return undefined
        }
      }}
    />
  )
}
