import { useState } from 'react'
import { ListChecks, PencilSimple, Plus, Trash } from '@phosphor-icons/react'

import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Label } from '@renderer/components/ui/label'
import type { ChecklistItem } from '@renderer/data/workspaces'
import { cn } from '@renderer/lib/utils'

const MAX_CHECKLIST_ITEMS = 50

/** Task checklist field — ported from the zinx-os `TaskChecklistField`: progress
 *  bar + done/total count, per-item checkbox with a display/edit toggle and
 *  delete, and an add button (plain text, no markdown). */
export function TaskChecklistField({
  items,
  onChange
}: {
  items: ChecklistItem[]
  onChange: (next: ChecklistItem[]) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState<{ id: string; original: string } | null>(null)

  const total = items.length
  const done = items.filter((item) => item.completed).length
  const atLimit = total >= MAX_CHECKLIST_ITEMS

  const update = (id: string, patch: Partial<ChecklistItem>): void =>
    onChange(items.map((item) => (item.id === id ? { ...item, ...patch } : item)))

  const remove = (id: string): void => {
    onChange(items.filter((item) => item.id !== id))
    if (editing?.id === id) setEditing(null)
  }

  const addItem = (): void => {
    if (atLimit) return
    const id = crypto.randomUUID()
    onChange([...items, { id, content: '', completed: false }])
    setEditing({ id, original: '' })
  }

  const doneEditing = (id: string): void => {
    setEditing(null)
    const item = items.find((entry) => entry.id === id)
    if (item && item.content.trim().length === 0) remove(id)
  }

  const cancelEditing = (): void => {
    if (!editing) return
    const { id, original } = editing
    setEditing(null)
    if (original.trim().length === 0) remove(id)
    else update(id, { content: original })
  }

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5 text-sm font-medium">
          <ListChecks className="size-3.5" weight="duotone" />
          Checklist
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        {total > 0 ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {done}/{total}
          </span>
        ) : null}
      </div>

      {total > 0 ? (
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${(done / total) * 100}%` }}
          />
        </div>
      ) : null}

      {total > 0 ? (
        <ul className="grid gap-1.5">
          {items.map((item) => {
            const isEditing = editing?.id === item.id
            return (
              <li key={item.id} className="flex items-start gap-2">
                <Checkbox
                  checked={item.completed}
                  onCheckedChange={(checked) => update(item.id, { completed: checked === true })}
                  className="mt-1.5 shrink-0"
                  aria-label={item.completed ? 'Mark incomplete' : 'Mark complete'}
                />
                <div className="min-w-0 flex-1">
                  {isEditing ? (
                    <div className="grid gap-1.5">
                      <textarea
                        autoFocus
                        value={item.content}
                        onChange={(event) => update(item.id, { content: event.target.value })}
                        placeholder="Checklist item…"
                        rows={2}
                        maxLength={500}
                        className="w-full resize-none rounded-md border border-input bg-transparent px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary dark:bg-input/30"
                      />
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="ghost" onClick={cancelEditing}>
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => doneEditing(item.id)}
                        >
                          Done
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        'min-h-7 py-1 text-sm',
                        item.completed && 'text-muted-foreground line-through'
                      )}
                    >
                      {item.content.trim().length > 0 ? (
                        item.content
                      ) : (
                        <span className="text-muted-foreground italic">Empty item</span>
                      )}
                    </div>
                  )}
                </div>
                {!isEditing ? (
                  <div className="flex shrink-0 items-center">
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7 text-muted-foreground"
                      onClick={() => setEditing({ id: item.id, original: item.content })}
                      aria-label="Edit item"
                    >
                      <PencilSimple className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      onClick={() => remove(item.id)}
                      aria-label="Remove item"
                    >
                      <Trash className="size-3.5" />
                    </Button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit gap-1.5"
        onClick={addItem}
        disabled={atLimit}
      >
        <Plus className="size-3.5" weight="bold" />
        Add item
      </Button>
    </div>
  )
}
