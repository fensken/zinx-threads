import { useState } from 'react'
import { CaretDown, Plus, Trash } from '@phosphor-icons/react'
import { cn } from '@renderer/lib/utils'
import { RenameField } from '@renderer/components/chat/rename-field'
import { ConfirmDialog } from '@renderer/components/common/confirm-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { DatabaseGrid } from './database-grid'
import { DatabaseBoard } from './database-board'
import { FieldDialog } from './field-dialog'
import { ViewIcon } from './database-icons'
import type {
  CellValue,
  DbField,
  DbFieldOption,
  DbFieldType,
  DbMember,
  DbRecord,
  DbView,
  DbViewConfig
} from './database-types'

type FieldInput = { name: string; type: DbFieldType; options?: DbFieldOption[] }

/**
 * The presentational Database channel — view tabs (Grid / Board) + the active view, over
 * `id`-based structural data. Both the online (`real-database-view.tsx`, Convex) and offline
 * (`local/local-database-view.tsx`, local store) adapters render this.
 */
export function DatabaseView({
  fields,
  records,
  views,
  members,
  saveStatus,
  onUpdateCell,
  onAddRecord,
  onDeleteRecord,
  onAddField,
  onUpdateField,
  onDeleteField,
  onUpdateView,
  onAddView,
  onRenameView,
  onDeleteView,
  onImport
}: {
  fields: DbField[]
  records: DbRecord[]
  views: DbView[]
  members: DbMember[]
  /** A "Saving… / Saved" pill, floated bottom-right (online adapter passes one). */
  saveStatus?: React.ReactNode
  onUpdateCell: (recordId: string, fieldId: string, value: CellValue) => void
  onAddRecord: (values?: Record<string, CellValue>) => void
  onDeleteRecord: (recordId: string) => void
  onAddField: (input: FieldInput) => void
  onUpdateField: (fieldId: string, input: FieldInput) => void
  onDeleteField: (fieldId: string) => void
  onUpdateView: (viewId: string, config: DbViewConfig) => void
  onAddView: (input: { name: string; type: DbView['type'] }) => void
  onRenameView: (viewId: string, name: string) => void
  onDeleteView: (viewId: string) => void
  onImport: (
    headers: string[],
    rows: string[][]
  ) => Promise<{ imported: number; skipped: number } | void> | void
}): React.JSX.Element {
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const [fieldDialog, setFieldDialog] = useState<'new' | DbField | null>(null)
  const [renamingViewId, setRenamingViewId] = useState<string | null>(null)
  const [deleteViewId, setDeleteViewId] = useState<string | null>(null)
  const activeView = views.find((v) => v.id === activeViewId) ?? views[0]

  const selectFields = fields.filter((f) => f.type === 'select')
  // The board groups by the configured select field, or the FIRST select field by default —
  // so a fresh board (or one whose group field was deleted) still works.
  const configuredGroupId = activeView?.config?.groupByFieldId
  const effectiveGroupId =
    (configuredGroupId && selectFields.some((f) => f.id === configuredGroupId)
      ? configuredGroupId
      : selectFields[0]?.id) ?? undefined
  const effectiveGroupField = selectFields.find((f) => f.id === effectiveGroupId)

  const boardView: DbView | undefined = activeView
    ? { ...activeView, config: { ...activeView.config, groupByFieldId: effectiveGroupId } }
    : undefined

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5">
        {views.map((view) =>
          renamingViewId === view.id ? (
            <div key={view.id} className="w-32">
              <RenameField
                initial={view.name}
                onCancel={() => setRenamingViewId(null)}
                onSubmit={(name) => {
                  const clean = name.trim()
                  if (clean && clean !== view.name) onRenameView(view.id, clean)
                  setRenamingViewId(null)
                }}
              />
            </div>
          ) : (
            <div key={view.id} className="flex items-center">
              <button
                type="button"
                onClick={() => setActiveViewId(view.id)}
                onDoubleClick={() => setRenamingViewId(view.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors',
                  activeView?.id === view.id
                    ? 'bg-accent font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                )}
              >
                <ViewIcon type={view.type} className="size-3.5" />
                {view.name}
              </button>
              {activeView?.id === view.id ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                        title="View options"
                      >
                        <CaretDown className="size-3.5" />
                      </button>
                    }
                  />
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => setRenamingViewId(view.id)}>
                      Rename view
                    </DropdownMenuItem>
                    {views.length > 1 ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setDeleteViewId(view.id)}
                        >
                          <Trash />
                          Delete view
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          )
        )}

        {/* Add a view */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="flex items-center gap-1 rounded-md px-1.5 py-1 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                title="Add a view"
              >
                <Plus className="size-4" weight="bold" />
              </button>
            }
          />
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => onAddView({ name: 'Grid', type: 'grid' })}>
              <ViewIcon type="grid" />
              Grid
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAddView({ name: 'Board', type: 'kanban' })}>
              <ViewIcon type="kanban" />
              Board
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* On the Board view, choose WHICH select field groups the cards. Labels only —
            never the field id. */}
        {activeView?.type === 'kanban' && selectFields.length > 0 ? (
          <div className="ml-auto flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Group by</span>
            <Select
              value={effectiveGroupId ?? ''}
              onValueChange={(value) =>
                onUpdateView(activeView.id, {
                  ...activeView.config,
                  groupByFieldId: value ?? undefined
                })
              }
            >
              <SelectTrigger size="sm" className="h-7 w-36">
                <span className="truncate">{effectiveGroupField?.name ?? 'Select a field'}</span>
              </SelectTrigger>
              <SelectContent>
                {selectFields.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {activeView?.type === 'kanban' && boardView ? (
        <DatabaseBoard
          view={boardView}
          fields={fields}
          records={records}
          members={members}
          onUpdateCell={onUpdateCell}
          onDeleteRecord={onDeleteRecord}
          onAddRecord={(groupValue) => {
            onAddRecord(
              effectiveGroupId && groupValue ? { [effectiveGroupId]: groupValue } : undefined
            )
          }}
        />
      ) : (
        <DatabaseGrid
          fields={fields}
          records={records}
          members={members}
          onUpdateCell={onUpdateCell}
          onDeleteRecord={onDeleteRecord}
          onAddRecord={() => onAddRecord()}
          onAddField={() => setFieldDialog('new')}
          onEditField={(field) => setFieldDialog(field)}
          onDeleteField={onDeleteField}
          onImport={onImport}
        />
      )}

      {saveStatus}

      <FieldDialog
        open={fieldDialog !== null}
        onOpenChange={(open) => !open && setFieldDialog(null)}
        field={fieldDialog && fieldDialog !== 'new' ? fieldDialog : undefined}
        onSubmit={(input) => {
          if (fieldDialog === 'new') onAddField(input)
          else if (fieldDialog) onUpdateField(fieldDialog.id, input)
        }}
      />

      <ConfirmDialog
        open={deleteViewId !== null}
        onOpenChange={(open) => !open && setDeleteViewId(null)}
        title="Delete this view?"
        description="The view is removed; your data (records + fields) is untouched."
        confirmLabel="Delete view"
        onConfirm={async () => {
          if (deleteViewId) onDeleteView(deleteViewId)
          setDeleteViewId(null)
        }}
      />
    </div>
  )
}
