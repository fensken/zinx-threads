import { useRef, useState } from 'react'
import { useMutation } from 'convex/react'
import { useQuery } from 'convex-helpers/react/cache/hooks'
import { toast } from 'sonner'
import {
  ArrowClockwise,
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  GlobeHemisphereWest,
  Plus,
  Trash,
  UsersThree,
  UserCircle
} from '@phosphor-icons/react'
import type { FunctionReturnType } from 'convex/server'
import { api } from '@convex/_generated/api'
import type { Doc, Id } from '@convex/_generated/dataModel'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Button } from '@renderer/components/ui/button'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { DescriptionEditor } from '@renderer/components/common/description-editor'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/components/ui/select'
import { errorMessage } from '@renderer/lib/convex-error'
import { copyToClipboard } from '@renderer/lib/clipboard'
import { formSubmitUrl } from '@renderer/lib/invite-links'
import { cn } from '@renderer/lib/utils'
import { useSaveStatus } from '@renderer/lib/use-save-status'
import { SaveStatus } from '@renderer/components/common/save-status'
import { FormSkeleton } from '@renderer/components/common/skeletons'
import { FormRenderer } from '@renderer/components/form/form-renderer'

const FORM_FIELD_TYPES: Record<string, string> = {
  text: 'Short text',
  longText: 'Long text',
  number: 'Number',
  email: 'Email',
  phone: 'Phone',
  url: 'URL',
  date: 'Date',
  time: 'Time',
  checkbox: 'Checkbox',
  switch: 'Switch',
  range: 'Slider',
  select: 'Dropdown',
  radio: 'Single choice',
  multiSelect: 'Multiple choice'
}

const AUDIENCE_META: Record<string, { label: string; hint: string; Icon: typeof UsersThree }> = {
  public: {
    label: 'Anyone with the link',
    hint: 'No account needed — share the link publicly.',
    Icon: GlobeHemisphereWest
  },
  authenticated: {
    label: 'Anyone signed in',
    hint: 'The respondent must be signed in to this app.',
    Icon: UserCircle
  },
  workspace: {
    label: 'Only this workspace',
    hint: 'Only members of this workspace can submit via the link.',
    Icon: UsersThree
  }
}

type FormData = NonNullable<FunctionReturnType<typeof api.forms.getByChannel>>
type FormField = FormData['form']['fields'][number]
type Audience = 'public' | 'authenticated' | 'workspace'

/**
 * A `form` channel. **By default it shows the fillable form**, so anyone who can see the
 * channel can respond right there (in-app). People who can manage the channel get an
 * **Edit form** button that opens the builder (fields, who-can-submit, the share link) and
 * the responses.
 */
export function RealFormEditor({
  channel,
  canManage
}: {
  channel: Doc<'channels'>
  canManage: boolean
}): React.JSX.Element {
  const data = useQuery(api.forms.getByChannel, { channelId: channel._id })
  const submitInApp = useMutation(api.forms.submitByChannel)
  const [tab, setTab] = useState<'preview' | 'build' | 'responses'>('preview')
  const { state: saveState, track } = useSaveStatus()

  if (data === undefined) {
    return <FormSkeleton withTabs={canManage} />
  }
  if (data === null) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        This form isn’t available.
      </div>
    )
  }

  // The fillable form — plain (no card), page-channel width. Everyone can fill it.
  const preview = (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <FormRenderer
          title={data.form.title}
          description={data.form.description}
          fields={data.form.fields}
          onSubmit={async (values) => {
            const result = await submitInApp({ channelId: channel._id, values })
            return result.confirmationMessage
          }}
        />
      </div>
    </div>
  )

  // People who can't manage the form see ONLY the form — no tabs.
  if (!canManage) {
    return <div className="flex min-h-0 min-w-0 flex-1 flex-col">{preview}</div>
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
        <Tab active={tab === 'preview'} onClick={() => setTab('preview')}>
          <Eye className="size-4" />
          Preview
        </Tab>
        <Tab active={tab === 'build'} onClick={() => setTab('build')}>
          Build
        </Tab>
        <Tab active={tab === 'responses'} onClick={() => setTab('responses')}>
          Responses ({data.responseCount}
          {data.responseCount >= 1000 ? '+' : ''})
        </Tab>
      </div>
      {tab === 'preview' ? (
        preview
      ) : tab === 'build' ? (
        <div className="relative min-h-0 flex-1">
          <div className="h-full overflow-y-auto">
            <FormBuilder key={channel._id} channelId={channel._id} form={data.form} track={track} />
          </div>
          <SaveStatus state={saveState} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FormResponses form={data.form} responses={data.responses} />
        </div>
      )}
    </div>
  )
}

function Tab({
  active,
  onClick,
  children
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-3 py-1 text-sm transition-colors',
        active
          ? 'bg-accent font-medium text-foreground'
          : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
      )}
    >
      {children}
    </button>
  )
}

function optionId(label: string, index: number): string {
  const slug = label
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 24)
  return `${slug || 'opt'}-${index}`
}

function FormBuilder({
  channelId,
  form,
  track
}: {
  channelId: Id<'channels'>
  form: FormData['form']
  track: (promise: Promise<unknown>) => Promise<unknown>
}): React.JSX.Element {
  const save = useMutation(api.forms.saveForm)
  const regenerate = useMutation(api.forms.regenerateLink)
  const descTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [fields, setFields] = useState<FormField[]>(form.fields)
  const [audience, setAudience] = useState<Audience>(
    form.audience ?? (form.requireSignIn ? 'authenticated' : 'public')
  )
  const [publicToken, setPublicToken] = useState(form.publicToken)

  const guard = async (promise: Promise<unknown>, fallback: string): Promise<void> => {
    try {
      await track(promise)
    } catch (err) {
      console.error(err)
      toast.error(errorMessage(err, fallback))
    }
  }

  const commitFields = (next: FormField[]): void => {
    setFields(next)
    void guard(save({ channelId, fields: next }), 'Could not save the form')
  }

  const addField = (): void => {
    const id = `f_${fields.length}_${Math.random().toString(36).slice(2, 7)}`
    commitFields([...fields, { id, name: 'Question', type: 'text', required: false }])
  }

  const moveField = (index: number, delta: number): void => {
    const next = [...fields]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    commitFields(next)
  }

  const link = formSubmitUrl(publicToken)

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <section className="space-y-2">
        <Label htmlFor="form-title">Title</Label>
        <Input
          id="form-title"
          defaultValue={form.title}
          onBlur={(e) => {
            const value = e.target.value.trim()
            if (value && value !== form.title)
              void guard(save({ channelId, title: value }), 'Could not save')
          }}
          maxLength={200}
        />
        <Label>Description</Label>
        {/* The app's one rich description editor (same as kanban tasks). Debounced save. */}
        <DescriptionEditor
          initialMarkdown={form.description ?? ''}
          placeholder="Describe your form…"
          onChange={(md) => {
            clearTimeout(descTimer.current)
            descTimer.current = setTimeout(() => {
              void guard(save({ channelId, description: md.trim() || null }), 'Could not save')
            }, 700)
          }}
        />
      </section>

      <section className="space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase">Fields</h4>
        {fields.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            No fields yet — add one below.
          </p>
        ) : (
          fields.map((field, index) => (
            <FieldRow
              key={field.id}
              field={field}
              index={index}
              count={fields.length}
              onChange={(next) => commitFields(fields.map((f, i) => (i === index ? next : f)))}
              onRemove={() => commitFields(fields.filter((_, i) => i !== index))}
              onMove={(delta) => moveField(index, delta)}
            />
          ))
        )}
        <Button type="button" variant="outline" size="sm" onClick={addField}>
          <Plus className="size-4" weight="bold" />
          Add field
        </Button>
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase">Who can submit</h4>
        <div className="w-full max-w-xs">
          <Select
            value={audience}
            onValueChange={(value) => {
              const next = (value ?? 'public') as Audience
              setAudience(next)
              void guard(save({ channelId, audience: next }), 'Could not save')
            }}
          >
            <SelectTrigger className="w-full">
              <span className="flex items-center gap-2">
                {(() => {
                  const Icon = AUDIENCE_META[audience].Icon
                  return <Icon className="size-4 text-muted-foreground" />
                })()}
                {AUDIENCE_META[audience].label}
              </span>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(AUDIENCE_META).map(([value, meta]) => (
                <SelectItem key={value} value={value}>
                  <span className="flex items-center gap-2">
                    <meta.Icon className="size-4 text-muted-foreground" />
                    {meta.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">{AUDIENCE_META[audience].hint}</p>
      </section>

      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase">Share link</h4>
        <div className="flex items-center gap-2">
          <Input readOnly value={link} className="font-mono text-xs" />
          <Button
            type="button"
            variant="outline"
            size="icon"
            title="Copy link"
            onClick={() => {
              void copyToClipboard(link)
              toast.success('Link copied')
            }}
          >
            <Copy className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            title="Generate a new link (revokes the old one)"
            onClick={() =>
              void guard(
                regenerate({ channelId }).then((r) => {
                  setPublicToken(r.publicToken)
                  toast.success('New link generated')
                }),
                'Could not regenerate the link'
              )
            }
          >
            <ArrowClockwise className="size-4" />
          </Button>
        </div>
      </section>
    </div>
  )
}

function FieldRow({
  field,
  index,
  count,
  onChange,
  onRemove,
  onMove
}: {
  field: FormField
  index: number
  count: number
  onChange: (next: FormField) => void
  onRemove: () => void
  onMove: (delta: number) => void
}): React.JSX.Element {
  const needsOptions =
    field.type === 'select' || field.type === 'multiSelect' || field.type === 'radio'
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Input
          defaultValue={field.name}
          key={`${field.id}-name`}
          onBlur={(e) => onChange({ ...field, name: e.target.value.trim() || 'Question' })}
          className="flex-1"
          placeholder="Question"
        />
        <div className="w-40">
          <Select
            value={field.type}
            onValueChange={(value) =>
              onChange({ ...field, type: (value ?? 'text') as FormField['type'] })
            }
          >
            <SelectTrigger className="w-full">
              <span className="truncate">{FORM_FIELD_TYPES[field.type] ?? field.type}</span>
            </SelectTrigger>
            <SelectContent>
              {Object.entries(FORM_FIELD_TYPES).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex shrink-0 items-center">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            title="Move up"
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
            title="Move down"
          >
            <ArrowDown className="size-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} title="Remove">
            <Trash className="size-4 text-muted-foreground hover:text-destructive" />
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            checked={field.required ?? false}
            onCheckedChange={(v) => onChange({ ...field, required: v === true })}
          />
          Required
        </label>
        {needsOptions ? (
          <Input
            key={`${field.id}-options`}
            defaultValue={(field.options ?? []).map((o) => o.label).join(', ')}
            onBlur={(e) => {
              // Preserve existing option ids — re-minting them from the label on every blur would
              // orphan every stored response that references the old id (and leak the raw id in the
              // Responses table). Reuse an existing id when its label still matches; only mint a new
              // id for a genuinely new option.
              const existing = field.options ?? []
              const usedIds = new Set<string>()
              const options = e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
                .map((label, i) => {
                  const match = existing.find(
                    (o) => o.label.toLowerCase() === label.toLowerCase() && !usedIds.has(o.id)
                  )
                  const id = match?.id ?? optionId(label, i)
                  usedIds.add(id)
                  return { id, label }
                })
              onChange({ ...field, options })
            }}
            placeholder="Option A, Option B, Option C"
            className="flex-1 text-xs"
          />
        ) : null}
      </div>
    </div>
  )
}

function FormResponses({
  form,
  responses
}: {
  form: FormData['form']
  responses: FormData['responses']
}): React.JSX.Element {
  const remove = useMutation(api.forms.deleteResponse)
  if (responses.length === 0) {
    return (
      <div className="flex min-h-40 items-center justify-center p-6 text-sm text-muted-foreground">
        No responses yet. Share the link, or people can fill it in the Preview.
      </div>
    )
  }
  const optionLabels = new Map<string, Map<string, string>>()
  for (const field of form.fields) {
    if (field.options)
      optionLabels.set(field.id, new Map(field.options.map((o) => [o.id, o.label])))
  }
  const cell = (field: FormField, value: unknown): string => {
    if (value === null || value === undefined) return ''
    const labels = optionLabels.get(field.id)
    if (Array.isArray(value))
      return value.map((v) => labels?.get(String(v)) ?? String(v)).join(', ')
    if (typeof value === 'boolean') return value ? 'Yes' : 'No'
    if (labels) return labels.get(String(value)) ?? String(value)
    return String(value)
  }
  return (
    <div className="overflow-auto p-4">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="border-b border-r bg-muted/50 px-2 py-1.5 text-left font-medium">
              Submitted
            </th>
            {form.fields.map((field) => (
              <th
                key={field.id}
                className="border-b border-r bg-muted/50 px-2 py-1.5 text-left font-medium"
              >
                {field.name}
              </th>
            ))}
            <th className="border-b bg-muted/50 px-2 py-1.5" />
          </tr>
        </thead>
        <tbody>
          {responses.map((response) => (
            <tr key={response._id} className="group/row hover:bg-accent/40">
              <td className="border-b border-r px-2 py-1.5 whitespace-nowrap text-muted-foreground">
                {new Date(response.submittedAt).toLocaleString()}
              </td>
              {form.fields.map((field) => (
                <td key={field.id} className="border-b border-r px-2 py-1.5">
                  {cell(field, response.values[field.id])}
                </td>
              ))}
              <td className="border-b px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => void remove({ responseId: response._id })}
                  className="opacity-0 transition-opacity group-hover/row:opacity-100"
                  title="Delete response"
                >
                  <Trash className="size-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
