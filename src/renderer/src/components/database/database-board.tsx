import { useEffect, useMemo, useState } from 'react'
import { Plus } from '@phosphor-icons/react'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Card } from '@renderer/components/ui/card'
import {
  Kanban,
  KanbanBoard,
  KanbanColumn,
  KanbanColumnContent,
  KanbanItem,
  KanbanItemHandle,
  KanbanOverlay
} from '@renderer/components/ui/kanban'
import { useDragPan } from '@renderer/lib/use-drag-pan'
import { cn } from '@renderer/lib/utils'
import { RecordDialog } from './record-dialog'
import type { CellValue, DbField, DbMember, DbRecord, DbView } from './database-types'

/**
 * The **Board** (kanban) view of a database — records grouped into columns by a `select`
 * field (`view.config.groupByFieldId`). It uses the SAME `Kanban` primitive as the kanban
 * board channel, so it looks and drags identically (Trello/Jira columns, card drag-drop,
 * board panning). Dropping a card in another column sets its group cell; database records
 * have one global order, so there's no per-column order to persist.
 */
const NONE = '__none__'

export function DatabaseBoard({
  view,
  fields,
  records,
  members,
  onUpdateCell,
  onAddRecord,
  onDeleteRecord
}: {
  view: DbView
  fields: DbField[]
  records: DbRecord[]
  members: DbMember[]
  onUpdateCell: (recordId: string, fieldId: string, value: CellValue) => void
  onAddRecord: (groupValue: string | null) => void
  onDeleteRecord: (recordId: string) => void
}): React.JSX.Element {
  const groupField = fields.find((f) => f.id === view.config?.groupByFieldId && f.type === 'select')
  const titleField = fields.find((f) => f.type === 'text')
  const pan = useDragPan('[data-slot="kanban-column"], button, input, form, [role="button"]')

  const [local, setLocal] = useState<Record<string, DbRecord[]> | null>(null)
  const [openRecordId, setOpenRecordId] = useState<string | null>(null)

  const columnDefs = useMemo(() => {
    if (!groupField) return []
    return [
      ...(groupField.options ?? []).map((o) => ({ id: o.id, label: o.label, color: o.color })),
      { id: NONE, label: `No ${groupField.name}`, color: undefined as string | undefined }
    ]
  }, [groupField])

  const serverValue = useMemo(() => {
    const value: Record<string, DbRecord[]> = {}
    for (const col of columnDefs) value[col.id] = []
    if (!groupField) return value
    for (const record of records) {
      const raw = record.values[groupField.id]
      const g = typeof raw === 'string' ? raw : ''
      const key = g && columnDefs.some((c) => c.id === g) ? g : NONE
      value[key]?.push(record)
    }
    return value
  }, [columnDefs, records, groupField])

  const signature = useMemo(
    () =>
      Object.entries(serverValue)
        .map(([col, recs]) => `${col}:${recs.map((r) => r.id).join(',')}`)
        .join('|'),
    [serverValue]
  )

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocal(null)
  }, [signature])

  if (!groupField) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        This board needs a <span className="mx-1 font-medium">Select</span> field to group by. Add
        one in the Grid view.
      </div>
    )
  }

  const value = local ?? serverValue

  const persist = (next: Record<string, DbRecord[]>): void => {
    for (const [colId, recs] of Object.entries(next)) {
      const targetGroup = colId === NONE ? '' : colId
      for (const record of recs) {
        const raw = record.values[groupField.id]
        const current = typeof raw === 'string' ? raw : ''
        if (current !== targetGroup) onUpdateCell(record.id, groupField.id, targetGroup || null)
      }
    }
  }

  const openRecord = openRecordId ? (records.find((r) => r.id === openRecordId) ?? null) : null

  return (
    <>
      <div className="min-h-0 flex-1 overflow-hidden bg-muted/20 p-4">
        <Kanban
          value={value}
          onValueChange={setLocal}
          onDragEnd={() => {
            if (local) persist(local)
          }}
          getItemValue={(record: DbRecord) => record.id}
          className="h-full"
        >
          <KanbanBoard
            onPointerDown={pan.onPointerDown}
            className={cn(
              'flex h-full items-start gap-4 overflow-x-auto overflow-y-hidden pb-1',
              pan.panning ? 'cursor-grabbing select-none' : 'cursor-grab'
            )}
          >
            {columnDefs.map((col) => (
              <BoardColumn
                key={col.id}
                col={col}
                records={value[col.id] ?? []}
                titleFieldId={titleField?.id}
                fields={fields}
                members={members}
                onOpen={(id) => setOpenRecordId(id)}
                onAdd={() => onAddRecord(col.id === NONE ? null : col.id)}
              />
            ))}
          </KanbanBoard>

          <KanbanOverlay>
            {({ value: dragged }) => {
              const record = records.find((r) => r.id === dragged)
              if (!record) return null
              return recordCard({
                record,
                titleFieldId: titleField?.id,
                fields,
                members,
                overlay: true
              })
            }}
          </KanbanOverlay>
        </Kanban>
      </div>

      <RecordDialog
        open={openRecord !== null}
        onOpenChange={(open) => !open && setOpenRecordId(null)}
        record={openRecord}
        fields={fields}
        members={members}
        onUpdateCell={onUpdateCell}
        onDelete={onDeleteRecord}
      />
    </>
  )
}

function BoardColumn({
  col,
  records,
  titleFieldId,
  fields,
  members,
  onOpen,
  onAdd
}: {
  col: { id: string; label: string; color?: string }
  records: DbRecord[]
  titleFieldId?: string
  fields: DbField[]
  members: DbMember[]
  onOpen: (recordId: string) => void
  onAdd: () => void
}): React.JSX.Element {
  return (
    <KanbanColumn
      value={col.id}
      className="flex max-h-full w-[280px] shrink-0 cursor-default flex-col sm:w-[300px]"
    >
      <Card data-size="sm" className="flex min-h-0 w-full flex-col gap-0 overflow-hidden py-0">
        <div className="flex shrink-0 items-center gap-2 px-3 py-2.5">
          {col.color ? (
            <span className="size-2.5 rounded-full" style={{ backgroundColor: col.color }} />
          ) : null}
          <span className="truncate text-sm font-semibold">{col.label}</span>
          <Badge variant="outline" className="shrink-0">
            {records.length}
          </Badge>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-2 pb-2">
          <KanbanColumnContent
            value={col.id}
            className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-0.5"
          >
            {records.map((record) => (
              <KanbanItem key={record.id} value={record.id}>
                {/* The card must be a plain <Card> ELEMENT (not a component) so the
                    primitive can merge the drag listeners onto its DOM node — a custom
                    component wouldn't forward them, and the card wouldn't drag. */}
                <KanbanItemHandle
                  render={recordCard({
                    record,
                    titleFieldId,
                    fields,
                    members,
                    onOpen: () => onOpen(record.id)
                  })}
                />
              </KanbanItem>
            ))}
          </KanbanColumnContent>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 h-8 w-full shrink-0 justify-start text-muted-foreground"
            onClick={onAdd}
          >
            <Plus className="size-4" weight="bold" />
            New
          </Button>
        </div>
      </Card>
    </KanbanColumn>
  )
}

/** Build the record's card as a plain `<Card>` ELEMENT (a render helper, not a component)
 *  so `KanbanItemHandle` can merge the drag listeners onto it — see the call site. */
function recordCard({
  record,
  titleFieldId,
  fields,
  members,
  overlay,
  onOpen
}: {
  record: DbRecord
  titleFieldId?: string
  fields: DbField[]
  members: DbMember[]
  overlay?: boolean
  onOpen?: () => void
}): React.JSX.Element {
  const title =
    titleFieldId && typeof record.values[titleFieldId] === 'string'
      ? (record.values[titleFieldId] as string)
      : 'Untitled'
  const chips = fields
    .filter((f) => f.id !== titleFieldId && f.type !== 'multiSelect')
    .map((f) => ({ field: f, text: chipText(f, record.values[f.id] ?? null, members) }))
    .filter((c) => c.text)
    .slice(0, 3)

  return (
    <Card
      data-size="sm"
      // A click (no drag movement) opens the record editor; the primitive's 6px activation
      // distance keeps a drag from firing this.
      onClick={overlay ? undefined : onOpen}
      className={cn(
        'cursor-grab gap-1.5 border p-2.5 shadow-sm transition-shadow hover:shadow-md',
        overlay && 'rotate-2 shadow-xl'
      )}
    >
      <p className="text-sm font-medium">{title.trim() || 'Untitled'}</p>
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {chips.map(({ field, text }) => (
            <Badge key={field.id} variant="secondary" className="text-[11px] font-normal">
              {text}
            </Badge>
          ))}
        </div>
      ) : null}
    </Card>
  )
}

/** A short display string for a card badge; empty string = don't show. */
function chipText(field: DbField, value: CellValue, members: DbMember[]): string {
  if (value === null || value === undefined || value === '') return ''
  if (field.type === 'select') return field.options?.find((o) => o.id === value)?.label ?? ''
  if (field.type === 'checkbox') return value === true ? field.name : ''
  if (field.type === 'user') return members.find((m) => m.userId === value)?.name ?? ''
  if (Array.isArray(value)) return value.length ? String(value.length) : ''
  return String(value)
}
