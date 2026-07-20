import { useState } from 'react'
import { CheckCircle } from '@phosphor-icons/react'
import { errorMessage } from '@renderer/lib/convex-error'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Switch } from '@renderer/components/ui/switch'
import { Slider } from '@renderer/components/ui/slider'
import { RadioGroup, RadioGroupItem } from '@renderer/components/ui/radio-group'
import { Textarea } from '@renderer/components/ui/textarea'
import { Spinner } from '@renderer/components/ui/spinner'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@renderer/components/ui/select'
import { DateField } from '@renderer/components/common/date-field'
import { TimeField } from '@renderer/components/common/time-field'
import { MarkdownMessage } from '@renderer/components/chat/markdown-message'

type CellValue = string | number | boolean | string[] | null

/** One form field, in the shape both `forms.publicGet` and `forms.getByChannel` return. */
export type FormFieldDef = {
  id: string
  name: string
  type: string
  required?: boolean
  options?: { id: string; label: string }[]
}

/**
 * The fillable form UI — renders each field, collects values, submits, and shows a
 * confirmation. Used by BOTH the public `/f/<token>` page and the in-app form-channel "fill"
 * view; the caller supplies the actual submit (public token vs member-by-channel), so the
 * rendering can't drift between the two surfaces.
 */
export function FormRenderer({
  title,
  description,
  fields,
  onSubmit,
  submitLabel = 'Submit'
}: {
  title: string
  description?: string | null
  fields: FormFieldDef[]
  /** Perform the submission; resolves to the confirmation message to show. */
  onSubmit: (values: Record<string, CellValue>) => Promise<string>
  submitLabel?: string
}): React.JSX.Element {
  const [values, setValues] = useState<Record<string, CellValue>>(() => initialValues(fields))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  if (done !== null) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <CheckCircle className="size-12 text-primary" weight="fill" />
        <p className="text-sm">{done}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setDone(null)
            setValues(initialValues(fields))
          }}
        >
          Submit another response
        </Button>
      </div>
    )
  }

  const setValue = (id: string, value: CellValue): void =>
    setValues((current) => ({ ...current, [id]: value }))

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const message = await onSubmit(values)
      setDone(message)
    } catch (err) {
      setError(errorMessage(err, 'Could not submit the form'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">{title}</h1>
      {description ? (
        <div className="mt-1.5 text-sm">
          <MarkdownMessage content={description} />
        </div>
      ) : null}
      <form onSubmit={(e) => void submit(e)} className="mt-5 space-y-4">
        {fields.map((field) => (
          <FormFieldInput
            key={field.id}
            field={field}
            value={values[field.id] ?? null}
            onChange={(v) => setValue(field.id, v)}
          />
        ))}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? <Spinner className="size-4" /> : null}
          {submitLabel}
        </Button>
      </form>
    </div>
  )
}

/** Seed the values map so a field that RENDERS a default (a range at 0, a time at 09:00) also
 *  STORES it — otherwise an untouched control shows a value that's silently dropped on submit
 *  (and, if required, fails "required" despite a value being visible). */
function initialValues(fields: FormFieldDef[]): Record<string, CellValue> {
  const init: Record<string, CellValue> = {}
  for (const field of fields) {
    if (field.type === 'range') init[field.id] = 0
    else if (field.type === 'time') init[field.id] = '09:00'
  }
  return init
}

function FieldLabel({ field }: { field: FormFieldDef }): React.JSX.Element {
  return (
    <Label className="mb-1.5 block">
      {field.name}
      {field.required ? <span className="ml-0.5 text-destructive">*</span> : null}
    </Label>
  )
}

function FormFieldInput({
  field,
  value,
  onChange
}: {
  field: FormFieldDef
  value: CellValue
  onChange: (value: CellValue) => void
}): React.JSX.Element {
  if (field.type === 'checkbox' || field.type === 'switch') {
    const Control = field.type === 'switch' ? Switch : Checkbox
    return (
      <label className="flex items-center gap-2">
        <Control checked={value === true} onCheckedChange={(v) => onChange(v === true)} />
        <span className="text-sm">
          {field.name}
          {field.required ? <span className="ml-0.5 text-destructive">*</span> : null}
        </span>
      </label>
    )
  }

  if (field.type === 'radio') {
    return (
      <div>
        <FieldLabel field={field} />
        <RadioGroup
          value={typeof value === 'string' ? value : ''}
          onValueChange={(v) => onChange((v as string) ?? null)}
          className="gap-1.5"
        >
          {field.options?.map((opt) => (
            <label key={opt.id} className="flex items-center gap-2 text-sm">
              <RadioGroupItem value={opt.id} />
              {opt.label}
            </label>
          ))}
        </RadioGroup>
      </div>
    )
  }

  if (field.type === 'range') {
    const n = typeof value === 'number' ? value : 0
    return (
      <div>
        <FieldLabel field={field} />
        <div className="flex items-center gap-3">
          <Slider
            value={[n]}
            min={0}
            max={100}
            step={1}
            onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
            className="flex-1"
          />
          <span className="w-8 text-right text-sm tabular-nums text-muted-foreground">{n}</span>
        </div>
      </div>
    )
  }

  if (field.type === 'date') {
    return (
      <div>
        <FieldLabel field={field} />
        <DateField value={typeof value === 'string' ? value : null} onChange={onChange} />
      </div>
    )
  }

  if (field.type === 'time') {
    return (
      <div>
        <FieldLabel field={field} />
        <TimeField
          value={typeof value === 'string' && value ? value : '09:00'}
          onChange={onChange}
        />
      </div>
    )
  }

  if (field.type === 'longText') {
    return (
      <div>
        <FieldLabel field={field} />
        <Textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          rows={4}
        />
      </div>
    )
  }

  if (field.type === 'select') {
    const chosen = field.options?.find((o) => o.id === value)
    return (
      <div>
        <FieldLabel field={field} />
        <Select
          value={typeof value === 'string' ? value : ''}
          onValueChange={(v) => onChange(v ?? null)}
        >
          <SelectTrigger className="w-full">
            {/* Label only — never the option id. */}
            <span className={chosen ? '' : 'text-muted-foreground'}>
              {chosen?.label ?? 'Select…'}
            </span>
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((opt) => (
              <SelectItem key={opt.id} value={opt.id}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    )
  }

  if (field.type === 'multiSelect') {
    const selected = Array.isArray(value) ? value : []
    return (
      <div>
        <FieldLabel field={field} />
        <div className="space-y-1.5">
          {field.options?.map((opt) => (
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
          ))}
        </div>
      </div>
    )
  }

  const inputType =
    field.type === 'number'
      ? 'number'
      : field.type === 'email'
        ? 'email'
        : field.type === 'url'
          ? 'url'
          : field.type === 'phone'
            ? 'tel'
            : 'text'
  return (
    <div>
      <FieldLabel field={field} />
      <Input
        type={inputType}
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
        required={field.required}
      />
    </div>
  )
}
