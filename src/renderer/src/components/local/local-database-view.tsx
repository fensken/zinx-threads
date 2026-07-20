import { useLocalStore } from '@renderer/store/local-store'
import { DatabaseView } from '@renderer/components/database/database-view'
import type { CellValue } from '@renderer/components/database/database-types'

/**
 * A `database` channel in the OFFLINE workspace — the local-store adapter. Renders the same
 * `DatabaseView` the online path does (Grid + Board), wiring every edit to the local store
 * (`<wsId>/databases/<channelId>.json` on disk). Local mode has no members, so `user`-type
 * fields have an empty picker. Mirrors `local-board-view.tsx` / `local-page-editor.tsx`.
 */
export function LocalDatabaseView({ channelId }: { channelId: string }): React.JSX.Element {
  const database = useLocalStore((state) => state.databases[channelId])
  const createDbField = useLocalStore((state) => state.createDbField)
  const updateDbField = useLocalStore((state) => state.updateDbField)
  const deleteDbField = useLocalStore((state) => state.deleteDbField)
  const updateDbView = useLocalStore((state) => state.updateDbView)
  const createDbView = useLocalStore((state) => state.createDbView)
  const renameDbView = useLocalStore((state) => state.renameDbView)
  const deleteDbView = useLocalStore((state) => state.deleteDbView)
  const createDbRecord = useLocalStore((state) => state.createDbRecord)
  const updateDbCell = useLocalStore((state) => state.updateDbCell)
  const deleteDbRecord = useLocalStore((state) => state.deleteDbRecord)
  const importDbRows = useLocalStore((state) => state.importDbRows)

  if (!database) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        This table isn’t available.
      </div>
    )
  }

  return (
    <DatabaseView
      fields={database.fields}
      records={database.records}
      views={database.views}
      members={[]}
      onUpdateCell={(recordId, fieldId, value: CellValue) =>
        updateDbCell(channelId, recordId, fieldId, value)
      }
      onAddRecord={(values) => createDbRecord(channelId, values)}
      onDeleteRecord={(recordId) => deleteDbRecord(channelId, recordId)}
      onAddField={(input) => createDbField(channelId, input)}
      onUpdateField={(fieldId, input) => updateDbField(channelId, fieldId, input)}
      onDeleteField={(fieldId) => deleteDbField(channelId, fieldId)}
      onUpdateView={(viewId, config) => updateDbView(channelId, viewId, config)}
      onAddView={(input) => createDbView(channelId, input)}
      onRenameView={(viewId, name) => renameDbView(channelId, viewId, name)}
      onDeleteView={(viewId) => deleteDbView(channelId, viewId)}
      onImport={(headers, rows) => importDbRows(channelId, headers, rows)}
    />
  )
}
