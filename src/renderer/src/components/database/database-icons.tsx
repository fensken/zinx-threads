import {
  CalendarBlank,
  CaretCircleDown,
  CheckSquare,
  GridFour,
  Hash,
  Images,
  Kanban,
  LinkSimple,
  ListChecks,
  Paragraph,
  SquaresFour,
  TextAa,
  User
} from '@phosphor-icons/react'
import type { DbFieldType, DbView } from './database-types'

/** A distinct icon per VIEW type (so the tabs don't all look like a table). */
export function ViewIcon({
  type,
  className
}: {
  type: DbView['type']
  className?: string
}): React.JSX.Element {
  if (type === 'kanban') return <Kanban className={className} />
  if (type === 'calendar') return <CalendarBlank className={className} />
  if (type === 'gallery') return <Images className={className} />
  return <GridFour className={className} />
}

/** A small icon per FIELD type, shown in each column header (Airtable-style). */
export function FieldTypeIcon({
  type,
  className
}: {
  type: DbFieldType
  className?: string
}): React.JSX.Element {
  switch (type) {
    case 'longText':
      return <Paragraph className={className} />
    case 'number':
      return <Hash className={className} />
    case 'select':
      return <CaretCircleDown className={className} />
    case 'multiSelect':
      return <ListChecks className={className} />
    case 'checkbox':
      return <CheckSquare className={className} />
    case 'date':
      return <CalendarBlank className={className} />
    case 'user':
      return <User className={className} />
    case 'url':
      return <LinkSimple className={className} />
    default:
      return <TextAa className={className} />
  }
}

/** For the "Add view" menu. */
export { GridFour, Kanban, SquaresFour }
