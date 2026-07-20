import { Trash } from '@phosphor-icons/react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Textarea } from '@renderer/components/ui/textarea'
import { Avatar, FALLBACK_AVATAR_COLOR } from '@renderer/components/common/avatar'
import { DateField } from '@renderer/components/common/date-field'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/components/ui/select'
import { initialsOf } from '@renderer/lib/initials'
import { FieldTypeIcon } from './database-icons'
import type { CellValue, DbField, DbMember, DbRecord } from './database-types'

/**
 * View + edit ALL of a record's fields in a form (opened from a Board card, so you can edit
 * data from the board — not just drag it). Each field commits through `onUpdateCell`; the
 * dialog reads the record live, so a change is reflected immediately.
 */
export function RecordDialog({
  open,
  onOpenChange,
  record,
  fields,
  members,
  onUpdateCell,
  onDelete
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: DbRecord | null
  fields: DbField[]
  members: DbMember[]
  onUpdateCell: (recordId: string, fieldId: string, value: CellValue) => void
  onDelete: (recordId: string) => void
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record</DialogTitle>
        </DialogHeader>
        {record ? (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            {fields.map((field) => (
              <div key={field.id}>
                <Label className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FieldTypeIcon type={field.type} className="size-3.5" />
                  {field.name}
                </Label>
                <RecordFieldEditor
                  field={field}
                  value={record.values[field.id] ?? null}
                  members={members}
                  onChange={(value) => onUpdateCell(record.id, field.id, value)}
                />
              </div>
            ))}
          </div>
        ) : null}
        <DialogFooter className="sm:justify-between">
          {record ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                onDelete(record.id)
                onOpenChange(false)
              }}
            >
              <Trash className="size-4" />
              Delete
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RecordFieldEditor({
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
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={value === true} onCheckedChange={(v) => onChange(v === true)} />
        {value === true ? 'Yes' : 'No'}
      </label>
    )
  }

  if (field.type === 'longText') {
    return (
      <Textarea
        defaultValue={typeof value === 'string' ? value : ''}
        onBlur={(e) => onChange(e.target.value || null)}
        rows={3}
      />
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
          {chosen ? (
            <span className="flex items-center gap-1.5">
              {chosen.color ? (
                <span className="size-2 rounded-full" style={{ backgroundColor: chosen.color }} />
              ) : null}
              {chosen.label}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </SelectTrigger>
        <SelectContent>
          {field.options?.map((opt) => (
            <SelectItem key={opt.id} value={opt.id}>
              {opt.label}
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
          {chosen ? (
            <span className="flex items-center gap-1.5">
              <Avatar
                initials={initialsOf(chosen.name)}
                color={chosen.color ?? FALLBACK_AVATAR_COLOR}
                image={chosen.avatarUrl}
                className="size-4"
              />
              {chosen.name}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
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
    const selected = Array.isArray(value) ? value : []
    return (
      <div className="space-y-1.5">
        {field.options?.length ? (
          field.options.map((opt) => (
            <label key={opt.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={selected.includes(opt.id)}
                onCheckedChange={(v) =>
                  onChange(
                    v === true ? [...selected, opt.id] : selected.filter((x) => x !== opt.id)
                  )
                }
              />
              {opt.label}
            </label>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">No options defined.</p>
        )}
      </div>
    )
  }

  if (field.type === 'date') {
    return <DateField value={typeof value === 'string' ? value : null} onChange={onChange} />
  }

  const type = field.type === 'number' ? 'number' : 'text'
  return (
    <Input
      type={type}
      defaultValue={value === null || value === undefined ? '' : String(value)}
      onBlur={(e) => {
        const v = e.target.value
        if (v === '') onChange(null)
        else if (field.type === 'number') {
          const n = Number(v)
          onChange(Number.isNaN(n) ? null : n)
        } else onChange(v)
      }}
    />
  )
}
