import { useState } from 'react'
import { Plus, Trash } from '@phosphor-icons/react'
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
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/components/ui/select'
import { ColorPickerButton } from '@renderer/components/common/color-picker-button'
import {
  FIELD_TYPES,
  FIELD_TYPE_LABEL,
  OPTION_COLORS,
  convertibleTypes,
  typeNeedsOptions
} from './database-types'
import type { DbField, DbFieldOption, DbFieldType } from './database-types'

/** Add a new field, or edit an existing one. In EDIT mode the type dropdown is limited to
 *  the types the current field can safely convert to (`convertibleTypes`), and existing
 *  select/multi-select option ids are preserved so stored cells keep pointing at them. */
export function FieldDialog({
  open,
  onOpenChange,
  field,
  onSubmit
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present = edit mode; absent = add mode. */
  field?: DbField
  onSubmit: (input: { name: string; type: DbFieldType; options?: DbFieldOption[] }) => void
}): React.JSX.Element {
  const [name, setName] = useState(field?.name ?? '')
  const [type, setType] = useState<DbFieldType>(field?.type ?? 'text')
  const [options, setOptions] = useState<DbFieldOption[]>(field?.options ?? [])

  // Reset the form each time the dialog opens (for a different field, or "add").
  const [seenKey, setSeenKey] = useState<string | null>(null)
  const key = open ? (field?.id ?? '__new__') : null
  if (key !== seenKey) {
    setSeenKey(key)
    if (open) {
      setName(field?.name ?? '')
      setType(field?.type ?? 'text')
      setOptions(field?.options ?? [])
    }
  }

  const typeChoices = field ? convertibleTypes(field.type) : FIELD_TYPES

  const addOption = (): void =>
    setOptions((prev) => [
      ...prev,
      {
        id: crypto.randomUUID().slice(0, 8),
        label: `Option ${prev.length + 1}`,
        color: OPTION_COLORS[prev.length % OPTION_COLORS.length]
      }
    ])

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    const clean = name.trim()
    if (!clean) return
    onSubmit({
      name: clean,
      type,
      options: typeNeedsOptions(type) ? options.filter((o) => o.label.trim()) : undefined
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{field ? 'Edit field' : 'Add a field'}</DialogTitle>
        </DialogHeader>
        <form id="field-form" onSubmit={submit} className="grid gap-3 py-1">
          <div className="grid gap-1.5">
            <Label htmlFor="field-name">Field name</Label>
            <Input
              id="field-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Priority"
              maxLength={100}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Type</Label>
            <Select
              value={type}
              onValueChange={(value) => setType((value ?? 'text') as DbFieldType)}
            >
              <SelectTrigger className="w-full">
                <span>{FIELD_TYPE_LABEL[type]}</span>
              </SelectTrigger>
              <SelectContent>
                {typeChoices.map((t) => (
                  <SelectItem key={t} value={t}>
                    {FIELD_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {field && convertibleTypes(field.type).length === 1 ? (
              <p className="text-xs text-muted-foreground">
                A {FIELD_TYPE_LABEL[field.type].toLowerCase()} field’s type can’t be changed.
              </p>
            ) : null}
          </div>

          {typeNeedsOptions(type) ? (
            <div className="grid gap-1.5">
              <Label>Options</Label>
              <div className="space-y-1.5">
                {options.map((option, index) => (
                  <div key={option.id} className="flex items-center gap-1.5">
                    <ColorPickerButton
                      color={option.color ?? OPTION_COLORS[index % OPTION_COLORS.length]}
                      presets={OPTION_COLORS}
                      onChange={(color) =>
                        setOptions((prev) =>
                          prev.map((o, i) => (i === index ? { ...o, color } : o))
                        )
                      }
                    />
                    <Input
                      value={option.label}
                      onChange={(e) =>
                        setOptions((prev) =>
                          prev.map((o, i) => (i === index ? { ...o, label: e.target.value } : o))
                        )
                      }
                      placeholder="Option"
                      className="h-8 flex-1"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setOptions((prev) => prev.filter((_, i) => i !== index))}
                      title="Remove option"
                    >
                      <Trash className="size-3.5 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="justify-start"
                onClick={addOption}
              >
                <Plus className="size-4" weight="bold" />
                Add option
              </Button>
            </div>
          ) : null}
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="field-form" disabled={!name.trim()}>
            {field ? 'Save' : 'Add field'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
