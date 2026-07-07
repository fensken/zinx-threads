import { useState } from 'react'
import { CalendarBlank, Check, Flag, Tag, Trash, User, X } from '@phosphor-icons/react'

import { Avatar, AvatarFallback } from '@renderer/components/ui/avatar'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { Calendar } from '@renderer/components/ui/calendar'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@renderer/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/components/ui/select'
import {
  getMembers,
  type ChecklistItem,
  type KanbanTask,
  type TaskPriority
} from '@renderer/data/workspaces'
import { cn } from '@renderer/lib/utils'
import { MarkdownTextarea } from './markdown-textarea'
import { TaskChecklistField } from './task-checklist-field'

const PRIORITY_ORDER: TaskPriority[] = ['lowest', 'low', 'medium', 'high', 'highest']
const PRIORITY_LABEL: Record<TaskPriority, string> = {
  lowest: 'Lowest',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  highest: 'Highest'
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function toISO(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
function fromISO(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Create / edit task dialog — ported from the zinx-os create-task / edit-task
 *  dialogs + task-form-fields (shadcn Dialog + markdown description + checklist +
 *  multi-assignee picker + priority/date/labels). Comments omitted for now. */
export function TaskDialog({
  mode,
  columnName,
  initial,
  serverId,
  onSubmit,
  onDelete,
  onClose
}: {
  mode: 'create' | 'edit'
  columnName?: string
  initial: KanbanTask
  serverId: string
  onSubmit: (fields: Partial<KanbanTask>) => void
  onDelete?: () => void
  onClose: () => void
}): React.JSX.Element {
  const members = getMembers(serverId)
  const memberById = new Map(members.map((member) => [member.id, member]))

  const [title, setTitle] = useState(initial.title)
  const [description, setDescription] = useState(initial.description ?? '')
  const [checklist, setChecklist] = useState<ChecklistItem[]>(initial.checklist ?? [])
  const [priority, setPriority] = useState<TaskPriority>(initial.priority)
  const [assigneeIds, setAssigneeIds] = useState<string[]>(initial.assigneeIds ?? [])
  const [dueDate, setDueDate] = useState(initial.dueDate ?? '')
  const [labels, setLabels] = useState<string[]>(initial.labels ?? [])
  const [labelInput, setLabelInput] = useState('')
  const [assigneeOpen, setAssigneeOpen] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)

  const toggleAssignee = (id: string): void =>
    setAssigneeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const addLabel = (): void => {
    const value = labelInput.trim()
    if (value && !labels.includes(value)) setLabels((prev) => [...prev, value])
    setLabelInput('')
  }

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault()
    if (title.trim().length < 2) return
    onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      checklist: checklist.filter((item) => item.content.trim().length > 0),
      priority,
      assigneeIds: assigneeIds.length ? assigneeIds : undefined,
      dueDate: dueDate || undefined,
      labels: labels.length ? labels : undefined
    })
    onClose()
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Create Task' : 'Edit Task'}</DialogTitle>
          <DialogDescription>
            {mode === 'create' ? `Adding to "${columnName ?? 'column'}".` : 'Update task details'}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto py-4">
          <form id="task-form" onSubmit={handleSubmit} className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="task-title" className="text-sm font-medium">
                Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="task-title"
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="What needs to be done?"
                maxLength={120}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="task-description" className="text-sm font-medium">
                Description
              </Label>
              <MarkdownTextarea
                id="task-description"
                value={description}
                onChange={setDescription}
                placeholder="Add a description…"
              />
            </div>

            <TaskChecklistField items={checklist} onChange={setChecklist} />

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label className="flex items-center gap-1.5 text-sm font-medium">
                  <Flag className="size-3.5" weight="duotone" />
                  Priority
                </Label>
                <Select
                  value={priority}
                  onValueChange={(value) => {
                    if (value) setPriority(value as TaskPriority)
                  }}
                >
                  <SelectTrigger className="w-full">
                    <span className="truncate">{PRIORITY_LABEL[priority]}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_ORDER.map((value) => (
                      <SelectItem key={value} value={value}>
                        {PRIORITY_LABEL[value]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label className="flex items-center gap-1.5 text-sm font-medium">
                  <User className="size-3.5" weight="duotone" />
                  Assignees
                </Label>
                <Popover open={assigneeOpen} onOpenChange={setAssigneeOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(
                          'h-auto min-h-9 w-full justify-start gap-1.5 font-normal',
                          assigneeIds.length === 0 && 'text-muted-foreground'
                        )}
                      />
                    }
                  >
                    {assigneeIds.length === 0 ? (
                      'Unassigned'
                    ) : (
                      <div className="flex flex-wrap items-center gap-1">
                        {assigneeIds.map((id) => {
                          const member = memberById.get(id)
                          if (!member) return null
                          return (
                            <Badge key={id} variant="secondary" className="gap-1 px-1.5 py-0.5">
                              <Avatar className="size-4">
                                <AvatarFallback
                                  className="text-[8px] font-semibold text-white"
                                  style={{ backgroundColor: member.color }}
                                >
                                  {member.initials}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-xs">{member.name}</span>
                              <span
                                role="button"
                                tabIndex={0}
                                aria-label={`Remove ${member.name}`}
                                className="ml-0.5 cursor-pointer rounded-sm hover:bg-foreground/10"
                                onClick={(event) => {
                                  event.stopPropagation()
                                  toggleAssignee(id)
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    toggleAssignee(id)
                                  }
                                }}
                              >
                                <X className="size-3" />
                              </span>
                            </Badge>
                          )
                        })}
                      </div>
                    )}
                  </PopoverTrigger>
                  <PopoverContent className="w-[280px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search members…" />
                      <CommandList>
                        <CommandEmpty>No members found.</CommandEmpty>
                        <CommandGroup>
                          {members.map((member) => {
                            const checked = assigneeIds.includes(member.id)
                            return (
                              <CommandItem
                                key={member.id}
                                value={member.name}
                                onSelect={() => toggleAssignee(member.id)}
                              >
                                <Avatar className="size-5">
                                  <AvatarFallback
                                    className="text-[9px] font-semibold text-white"
                                    style={{ backgroundColor: member.color }}
                                  >
                                    {member.initials}
                                  </AvatarFallback>
                                </Avatar>
                                <span className="flex-1 truncate text-sm">{member.name}</span>
                                {checked ? <Check className="size-4" weight="bold" /> : null}
                              </CommandItem>
                            )
                          })}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label className="flex items-center gap-1.5 text-sm font-medium">
                  <CalendarBlank className="size-3.5" weight="duotone" />
                  Due Date
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Popover open={dateOpen} onOpenChange={setDateOpen}>
                  <PopoverTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        className={cn(
                          'h-9 w-full justify-between gap-1.5 font-normal',
                          !dueDate && 'text-muted-foreground'
                        )}
                      />
                    }
                  >
                    {dueDate
                      ? fromISO(dueDate).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                        })
                      : 'Pick a date'}
                    <CalendarBlank className="size-4 opacity-70" />
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={dueDate ? fromISO(dueDate) : undefined}
                      onSelect={(date) => {
                        setDueDate(date ? toISO(date) : '')
                        setDateOpen(false)
                      }}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="grid gap-2">
                <Label className="flex items-center gap-1.5 text-sm font-medium">
                  <Tag className="size-3.5" weight="duotone" />
                  Labels
                </Label>
                <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input px-2 py-1 dark:bg-input/30">
                  {labels.map((label) => (
                    <Badge key={label} variant="secondary" className="gap-1 px-1.5 py-0.5">
                      {label}
                      <button
                        type="button"
                        aria-label={`Remove ${label}`}
                        onClick={() => setLabels((prev) => prev.filter((item) => item !== label))}
                        className="ml-0.5 rounded-sm text-muted-foreground hover:text-foreground"
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                  <input
                    value={labelInput}
                    onChange={(event) => setLabelInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        addLabel()
                      }
                    }}
                    onBlur={addLabel}
                    placeholder={labels.length === 0 ? 'backend, frontend, ui/ux…' : 'Add label'}
                    className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                </div>
              </div>
            </div>
          </form>
        </div>

        <DialogFooter className="sm:justify-between">
          {mode === 'edit' && onDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                onDelete()
                onClose()
              }}
            >
              <Trash className="size-4" />
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="task-form" disabled={title.trim().length < 2}>
              {mode === 'create' ? 'Create Task' : 'Save Changes'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
