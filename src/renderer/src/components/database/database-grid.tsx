import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ArrowDown,
  ArrowUp,
  CaretUpDown,
  DownloadSimple,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
  UploadSimple,
  X
} from '@phosphor-icons/react'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Avatar, FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import { ConfirmDialog } from '@renderer/components/common/confirm-dialog'
import { DateField } from '@renderer/components/common/date-field'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { initialsOf } from '@renderer/lib/initials'
import { toast } from 'sonner'
import { cn } from '@renderer/lib/utils'
import { downloadCsv, parseCsv, recordsToCsv } from '@renderer/lib/database-csv'
import { cellText, compareCells } from './database-types'
import { FieldTypeIcon } from './database-icons'
import type { CellValue, DbField, DbFieldType, DbMember, DbRecord } from './database-types'

/** Cap CSV import rows so a giant paste doesn't lock up the mutation. */
const MAX_IMPORT_ROWS = 2000

/**
 * The **Grid** (data-table) view of a database. Rows are **virtualized**
 * (`@tanstack/react-virtual`) so it stays fast at thousands of records; columns are
 * **resizable** with a sticky header. Includes a toolbar with **search**, click-to-**sort**
 * columns, **row multi-select** with **bulk edit / delete**, and a confirmed single-row
 * delete. Presentational — the adapter owns the data + mutations.
 */

const ROW_H = 36
const SELECT_W = 40
const ACTION_W = 120

type Sort = { fieldId: string; dir: 'asc' | 'desc' }

function defaultWidth(type: DbFieldType): number {
  switch (type) {
    case 'checkbox':
      return 90
    case 'number':
      return 120
    case 'date':
      return 150
    case 'select':
    case 'multiSelect':
    case 'user':
      return 190
    default:
      return 220
  }
}

export function DatabaseGrid({
  fields,
  records,
  members,
  onUpdateCell,
  onDeleteRecord,
  onAddRecord,
  onAddField,
  onEditField,
  onDeleteField,
  onImport
}: {
  fields: DbField[]
  records: DbRecord[]
  members: DbMember[]
  onUpdateCell: (recordId: string, fieldId: string, value: CellValue) => void
  onDeleteRecord: (recordId: string) => void
  onAddRecord: () => void
  onAddField: () => void
  onEditField: (field: DbField) => void
  onDeleteField: (fieldId: string) => void
  onImport: (
    headers: string[],
    rows: string[][]
  ) => Promise<{ imported: number; skipped: number } | void> | void
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [widths, setWidths] = useState<Record<string, number>>({})
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  const widthOf = (field: DbField): number => widths[field.id] ?? defaultWidth(field.type)

  const displayed = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = q
      ? records.filter((r) =>
          fields.some((f) =>
            cellText(f, r.values[f.id] ?? null, members)
              .toLowerCase()
              .includes(q)
          )
        )
      : records
    if (sort) {
      const field = fields.find((f) => f.id === sort.fieldId)
      if (field) {
        rows = [...rows].sort((a, b) => {
          const cmp = compareCells(
            field,
            a.values[field.id] ?? null,
            b.values[field.id] ?? null,
            members
          )
          return sort.dir === 'asc' ? cmp : -cmp
        })
      }
    }
    return rows
  }, [records, fields, members, search, sort])

  // React Compiler skips memoizing this (TanStack Virtual's API) — fine, the virtualizer
  // is what keeps the grid fast, and its values aren't passed to memoized children.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: displayed.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12
  })

  const bodyWidth = SELECT_W + fields.reduce((sum, f) => sum + widthOf(f), 0) + ACTION_W
  const nameFieldId = fields.find((f) => f.type === 'text')?.id

  // Bulk actions must only ever touch CURRENTLY-VISIBLE rows — a stale selection left over
  // from before a search narrowed the list would otherwise delete/edit rows the user can't see.
  const visibleIds = useMemo(() => new Set(displayed.map((r) => r.id)), [displayed])
  const selectedVisible = useMemo(
    () => [...selected].filter((id) => visibleIds.has(id)),
    [selected, visibleIds]
  )
  const allSelected = displayed.length > 0 && displayed.every((r) => selected.has(r.id))
  const someSelected = selectedVisible.length > 0
  const toggleAll = (): void =>
    setSelected(allSelected ? new Set() : new Set(displayed.map((r) => r.id)))
  const toggleOne = (id: string): void =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const cycleSort = (fieldId: string): void =>
    setSort((prev) =>
      prev?.fieldId !== fieldId
        ? { fieldId, dir: 'asc' }
        : prev.dir === 'asc'
          ? { fieldId, dir: 'desc' }
          : null
    )

  const bulkDelete = (): void => {
    for (const id of selectedVisible) onDeleteRecord(id)
    setSelected(new Set())
  }

  const exportCsv = (): void => {
    downloadCsv('table', recordsToCsv(fields, records, members))
  }

  const importCsv = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0]
    event.target.value = '' // let the same file be picked again later
    if (!file) return
    try {
      const parsed = parseCsv(await file.text())
      if (parsed.length < 2) {
        toast.error('That CSV has no data rows.')
        return
      }
      const [headers, ...rows] = parsed
      const sent = rows.slice(0, MAX_IMPORT_ROWS)
      const clientTruncated = rows.length - sent.length // rows past the client cap, never sent
      const result = await onImport(headers, sent)
      // The server (online) enforces the record cap and returns what it actually inserted;
      // fall back to the sent count offline (no server-side skips there).
      const imported = result ? result.imported : sent.length
      const skipped = (result ? result.skipped : 0) + clientTruncated
      if (skipped > 0) {
        toast.warning(`Imported ${imported} row${imported === 1 ? '' : 's'}; ${skipped} skipped.`)
      } else {
        toast.success(`Imported ${imported} row${imported === 1 ? '' : 's'}.`)
      }
    } catch {
      toast.error('Could not read that CSV file.')
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <div className="relative w-56">
          <MagnifyingGlass className="absolute top-1/2 left-2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search records…"
            className="h-8 pl-7"
          />
        </div>
        <span className="text-xs text-muted-foreground">
          {displayed.length} {displayed.length === 1 ? 'record' : 'records'}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={exportCsv}
          title="Export as CSV (opens in Excel / Sheets)"
        >
          <DownloadSimple className="size-4" />
          Export
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          title="Import a CSV file"
        >
          <UploadSimple className="size-4" />
          Import
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => void importCsv(e)}
        />
        {someSelected ? (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs font-medium">{selectedVisible.length} selected</span>
            <BulkEditPopover
              fields={fields}
              members={members}
              onApply={(fieldId, value) => {
                for (const id of selectedVisible) onUpdateCell(id, fieldId, value)
                setSelected(new Set())
              }}
            />
            <Button variant="outline" size="sm" onClick={() => setBulkDeleteOpen(true)}>
              <Trash className="size-4" />
              Delete
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setSelected(new Set())}
              title="Clear"
            >
              <X className="size-4" />
            </Button>
          </div>
        ) : null}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div style={{ width: bodyWidth, minWidth: '100%' }}>
          {/* Header */}
          <div
            className="sticky top-0 z-20 flex border-b bg-muted/60 backdrop-blur"
            style={{ width: bodyWidth }}
          >
            <div
              className="flex shrink-0 items-center justify-center border-r"
              style={{ width: SELECT_W }}
            >
              <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
            </div>
            {fields.map((field) => (
              <HeaderCell
                key={field.id}
                field={field}
                width={widthOf(field)}
                deletable={field.id !== nameFieldId}
                sortDir={sort?.fieldId === field.id ? sort.dir : null}
                onSort={() => cycleSort(field.id)}
                onEdit={() => onEditField(field)}
                onResize={(w) => setWidths((prev) => ({ ...prev, [field.id]: w }))}
                onDelete={() => onDeleteField(field.id)}
              />
            ))}
            <div className="flex shrink-0 items-center px-2" style={{ width: ACTION_W }}>
              <button
                type="button"
                onClick={onAddField}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                title="Add a field"
              >
                <Plus className="size-3.5" weight="bold" />
                Field
              </button>
            </div>
          </div>

          {/* Virtualized body */}
          <div
            className="relative"
            style={{ height: rowVirtualizer.getTotalSize(), width: bodyWidth }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const record = displayed[virtualRow.index]
              const isSelected = selected.has(record.id)
              return (
                <div
                  key={record.id}
                  className={cn(
                    'group/row absolute left-0 flex border-b hover:bg-accent/30',
                    isSelected && 'bg-primary/5'
                  )}
                  style={{ top: virtualRow.start, height: ROW_H, width: bodyWidth }}
                >
                  <div
                    className="flex shrink-0 items-center justify-center border-r"
                    style={{ width: SELECT_W }}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleOne(record.id)}
                      className={cn(
                        !isSelected && !someSelected && 'opacity-0 group-hover/row:opacity-100'
                      )}
                      aria-label="Select row"
                    />
                  </div>
                  {fields.map((field) => (
                    <div
                      key={field.id}
                      className="shrink-0 border-r"
                      style={{ width: widthOf(field) }}
                    >
                      <DatabaseCell
                        field={field}
                        value={record.values[field.id] ?? null}
                        members={members}
                        onChange={(value) => onUpdateCell(record.id, field.id, value)}
                      />
                    </div>
                  ))}
                  <div className="flex shrink-0 items-center px-3" style={{ width: ACTION_W }}>
                    <button
                      type="button"
                      onClick={() => setDeleteId(record.id)}
                      className="text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 hover:text-destructive"
                      title="Delete record"
                    >
                      <Trash className="size-3.5" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <button
            type="button"
            onClick={onAddRecord}
            className="flex items-center gap-1.5 border-b px-3 py-2 text-sm text-muted-foreground hover:bg-accent/40 hover:text-foreground"
            style={{ width: bodyWidth }}
          >
            <Plus className="size-4" weight="bold" />
            New record
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="Delete record?"
        description="This permanently removes the record. This can’t be undone."
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleteId) onDeleteRecord(deleteId)
          setDeleteId(null)
        }}
      />
      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Delete ${selectedVisible.length} record${selectedVisible.length === 1 ? '' : 's'}?`}
        description="This permanently removes the selected records. This can’t be undone."
        confirmLabel="Delete"
        onConfirm={async () => bulkDelete()}
      />
    </div>
  )
}

function HeaderCell({
  field,
  width,
  deletable,
  sortDir,
  onSort,
  onEdit,
  onResize,
  onDelete
}: {
  field: DbField
  width: number
  deletable: boolean
  sortDir: 'asc' | 'desc' | null
  onSort: () => void
  onEdit: () => void
  onResize: (width: number) => void
  onDelete: () => void
}): React.JSX.Element {
  const startResize = (event: React.PointerEvent): void => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = width
    const move = (e: PointerEvent): void =>
      onResize(Math.max(80, startWidth + (e.clientX - startX)))
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div
      className="group/col relative flex shrink-0 items-center gap-1 border-r px-2 py-1.5 text-sm font-medium"
      style={{ width }}
    >
      <button
        type="button"
        onClick={onSort}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left hover:text-foreground"
        title="Sort by this field"
      >
        <FieldTypeIcon type={field.type} className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{field.name}</span>
        {sortDir === 'asc' ? (
          <ArrowUp className="size-3.5 shrink-0 text-primary" weight="bold" />
        ) : sortDir === 'desc' ? (
          <ArrowDown className="size-3.5 shrink-0 text-primary" weight="bold" />
        ) : (
          <CaretUpDown className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/col:opacity-40" />
        )}
      </button>
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/col:opacity-100">
        <button type="button" onClick={onEdit} title={`Edit field "${field.name}"`}>
          <PencilSimple className="size-3.5 text-muted-foreground hover:text-foreground" />
        </button>
        {deletable ? (
          <button type="button" onClick={onDelete} title={`Delete field "${field.name}"`}>
            <Trash className="size-3.5 text-muted-foreground hover:text-destructive" />
          </button>
        ) : null}
      </div>
      <div
        onPointerDown={startResize}
        className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-primary/40"
      />
    </div>
  )
}

/** Bulk-edit a single field across the selected rows. */
function BulkEditPopover({
  fields,
  members,
  onApply
}: {
  fields: DbField[]
  members: DbMember[]
  onApply: (fieldId: string, value: CellValue) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [fieldId, setFieldId] = useState<string>(fields[0]?.id ?? '')
  const [value, setValue] = useState<CellValue>('')
  const field = fields.find((f) => f.id === fieldId)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm">
            <PencilSimple className="size-4" />
            Edit
          </Button>
        }
      />
      <PopoverContent align="end" className="w-64 space-y-2 p-3">
        <p className="text-xs font-medium text-muted-foreground">Set a field for all selected</p>
        <Select
          value={fieldId}
          onValueChange={(v) => {
            setFieldId(v ?? '')
            setValue('')
          }}
        >
          <SelectTrigger className="w-full">
            <span className="truncate">{field?.name ?? 'Choose a field'}</span>
          </SelectTrigger>
          <SelectContent>
            {fields.map((f) => (
              <SelectItem key={f.id} value={f.id}>
                {f.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {field ? (
          <BulkValueInput field={field} members={members} value={value} onChange={setValue} />
        ) : null}
        <Button
          size="sm"
          className="w-full"
          onClick={() => {
            if (field) onApply(field.id, value === '' ? null : value)
            setOpen(false)
            setValue('')
          }}
        >
          Apply
        </Button>
      </PopoverContent>
    </Popover>
  )
}

function BulkValueInput({
  field,
  members,
  value,
  onChange
}: {
  field: DbField
  members: DbMember[]
  value: CellValue
  onChange: (value: CellValue) => void
}): React.JSX.Element {
  if (field.type === 'checkbox') {
    return (
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={value === true} onCheckedChange={(v) => onChange(v === true)} />
        Checked
      </label>
    )
  }
  if (field.type === 'select') {
    const chosen = field.options?.find((o) => o.id === value)
    return (
      <Select
        value={typeof value === 'string' ? value : ''}
        onValueChange={(v) => onChange(v || null)}
      >
        <SelectTrigger className="w-full">
          <span className={cn('truncate', !chosen && 'text-muted-foreground')}>
            {chosen?.label ?? 'Choose…'}
          </span>
        </SelectTrigger>
        <SelectContent>
          {field.options?.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (field.type === 'user') {
    const chosen = members.find((m) => m.userId === value)
    return (
      <Select
        value={typeof value === 'string' ? value : ''}
        onValueChange={(v) => onChange(v || null)}
      >
        <SelectTrigger className="w-full">
          <span className={cn('truncate', !chosen && 'text-muted-foreground')}>
            {chosen?.name ?? 'Choose…'}
          </span>
        </SelectTrigger>
        <SelectContent>
          {members.map((m) => (
            <SelectItem key={m.userId} value={m.userId}>
              {m.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (field.type === 'multiSelect') {
    // Must set an array — a text <Input> here would store a raw string into a multiSelect cell.
    const selected = Array.isArray(value) ? value : []
    return (
      <div className="max-h-40 space-y-1.5 overflow-y-auto">
        {field.options?.length ? (
          field.options.map((o) => (
            <label key={o.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.includes(o.id)}
                onCheckedChange={(v) =>
                  onChange(v === true ? [...selected, o.id] : selected.filter((x) => x !== o.id))
                }
              />
              {o.color ? (
                <span className="size-2 rounded-full" style={{ backgroundColor: o.color }} />
              ) : null}
              {o.label}
            </label>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">No options</p>
        )}
      </div>
    )
  }
  if (field.type === 'date') {
    return (
      <DateField
        value={typeof value === 'string' ? value : null}
        onChange={onChange}
        className="w-full"
      />
    )
  }
  const type = field.type === 'number' ? 'number' : 'text'
  return (
    <Input
      type={type}
      value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
      onChange={(e) =>
        onChange(
          field.type === 'number'
            ? e.target.value === ''
              ? null
              : Number(e.target.value)
            : e.target.value
        )
      }
      placeholder="Value"
    />
  )
}

function DatabaseCell({
  field,
  value,
  members,
  onChange
}: {
  field: DbField
  value: CellValue
  members: DbMember[]
  onChange: (value: CellValue) => void
}): React.JSX.Element {
  if (field.type === 'checkbox') {
    return (
      <div className="flex h-full items-center justify-center">
        <Checkbox checked={value === true} onCheckedChange={(v) => onChange(v === true)} />
      </div>
    )
  }

  if (field.type === 'select') {
    const chosen = field.options?.find((o) => o.id === value)
    return (
      <Select
        value={typeof value === 'string' ? value : ''}
        onValueChange={(v) => onChange(v || null)}
      >
        <SelectTrigger
          size="sm"
          className="h-full w-full rounded-none border-0 px-2 shadow-none focus-visible:ring-1"
        >
          {/* Render the option LABEL, never its id. */}
          {chosen ? (
            <span className="flex min-w-0 items-center gap-1.5">
              {chosen.color ? (
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: chosen.color }}
                />
              ) : null}
              <span className="truncate">{chosen.label}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </SelectTrigger>
        <SelectContent>
          {field.options?.map((opt) => (
            <SelectItem key={opt.id} value={opt.id}>
              <span className="flex items-center gap-1.5">
                {opt.color ? (
                  <span className="size-2 rounded-full" style={{ backgroundColor: opt.color }} />
                ) : null}
                {opt.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (field.type === 'user') {
    const chosen = members.find((m) => m.userId === value)
    return (
      <Select
        value={typeof value === 'string' ? value : ''}
        onValueChange={(v) => onChange(v || null)}
      >
        <SelectTrigger
          size="sm"
          className="h-full w-full rounded-none border-0 px-2 shadow-none focus-visible:ring-1"
        >
          {/* Render the member NAME + avatar, never the user id. */}
          {chosen ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <Avatar
                initials={initialsOf(chosen.name)}
                color={chosen.color ?? FALLBACK_AVATAR_COLOR}
                image={chosen.avatarUrl}
                className="size-4 shrink-0"
              />
              <span className="truncate">{chosen.name}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </SelectTrigger>
        <SelectContent>
          {members.map((m) => (
            <SelectItem key={m.userId} value={m.userId}>
              <span className="flex items-center gap-1.5">
                <Avatar
                  initials={initialsOf(m.name)}
                  color={m.color ?? FALLBACK_AVATAR_COLOR}
                  image={m.avatarUrl}
                  className="size-4"
                />
                {m.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (field.type === 'multiSelect') {
    return (
      <MultiSelectCell
        field={field}
        selected={Array.isArray(value) ? value : []}
        onChange={onChange}
      />
    )
  }

  if (field.type === 'date') {
    return (
      <DateField
        value={typeof value === 'string' ? value : null}
        onChange={onChange}
        placeholder="—"
        className="h-full min-h-0 rounded-none border-0 bg-transparent px-2 shadow-none"
      />
    )
  }

  if (field.type === 'longText') {
    return <LongTextCell value={typeof value === 'string' ? value : ''} onCommit={onChange} />
  }

  return (
    <TextCell
      value={value}
      type={field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'}
      onCommit={onChange}
    />
  )
}

function TextCell({
  value,
  type,
  onCommit
}: {
  value: CellValue
  type: 'text' | 'number' | 'url'
  onCommit: (value: CellValue) => void
}): React.JSX.Element {
  const initial = value === null || value === undefined ? '' : String(value)
  const [local, setLocal] = useState(initial)
  const [seen, setSeen] = useState(initial)
  if (initial !== seen) {
    setSeen(initial)
    setLocal(initial)
  }
  const commit = (): void => {
    if (local === initial) return
    if (local === '') onCommit(null)
    else if (type === 'number') {
      const n = Number(local)
      onCommit(Number.isNaN(n) ? null : n)
    } else onCommit(local)
  }
  return (
    <input
      type={type === 'number' ? 'number' : 'text'}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      className="h-full w-full border-0 bg-transparent px-2 text-sm outline-none focus:bg-background"
    />
  )
}

/** A long-text cell — truncated in the row, editable in a popover textarea (a fixed row
 *  height can't hold multi-line text, so it expands like Airtable's). */
function LongTextCell({
  value,
  onCommit
}: {
  value: string
  onCommit: (value: CellValue) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState(value)
  const [seen, setSeen] = useState(value)
  if (value !== seen) {
    setSeen(value)
    setLocal(value)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next && local !== value) onCommit(local || null)
      }}
    >
      <PopoverTrigger className="flex h-full w-full items-center px-2 text-left">
        <span className="truncate text-sm">
          {value || <span className="text-muted-foreground">—</span>}
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <textarea
          autoFocus
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          rows={5}
          className="w-full resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none focus:border-ring"
        />
      </PopoverContent>
    </Popover>
  )
}

function MultiSelectCell({
  field,
  selected,
  onChange
}: {
  field: DbField
  selected: string[]
  onChange: (value: string[]) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const toggle = (id: string): void =>
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  const labelFor = (id: string): string | null =>
    field.options?.find((o) => o.id === id)?.label ?? null
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="flex h-full w-full flex-wrap items-center gap-1 overflow-hidden px-2 text-left">
        {selected.length === 0 ? (
          <span className="text-sm text-muted-foreground">—</span>
        ) : (
          selected.map((id) => {
            // A removed option must never render its raw id — show a muted placeholder instead.
            const label = labelFor(id)
            return label ? (
              <span key={id} className="rounded bg-accent px-1.5 py-0.5 text-xs whitespace-nowrap">
                {label}
              </span>
            ) : (
              <span
                key={id}
                className="rounded bg-muted px-1.5 py-0.5 text-xs whitespace-nowrap text-muted-foreground italic"
              >
                removed
              </span>
            )
          })
        )}
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start">
        {field.options?.length ? (
          field.options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => toggle(opt.id)}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
            >
              <Checkbox checked={selected.includes(opt.id)} className="pointer-events-none" />
              {opt.label}
            </button>
          ))
        ) : (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">No options defined.</p>
        )}
      </PopoverContent>
    </Popover>
  )
}
