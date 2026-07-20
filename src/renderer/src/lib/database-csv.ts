import { cellText } from '@renderer/components/database/database-types'
import type {
  CellValue,
  DbField,
  DbMember,
  DbRecord
} from '@renderer/components/database/database-types'

/**
 * CSV import/export for a database. CSV is the universal format — it opens directly in
 * Excel, Google Sheets and Numbers — so "export as a spreadsheet" is a CSV download, and
 * import accepts a CSV exported from any of those.
 */

/** Quote a CSV field when it contains a comma, quote, or newline (RFC 4180). */
function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/** One cell → CSV text. multiSelect must use a delimiter the importer can split back apart
 *  (`parseCsv` → `split(/[;,]/)`); `cellText`'s space-join would collapse the labels into one
 *  unmatchable token on re-import, silently dropping the whole cell. */
function csvCell(field: DbField, value: CellValue, members: DbMember[]): string {
  if (field.type === 'multiSelect' && Array.isArray(value)) {
    return value
      .map((v) => field.options?.find((o) => o.id === v)?.label)
      .filter((label): label is string => Boolean(label))
      .join('; ')
  }
  return cellText(field, value, members)
}

/** Serialize the fields (as headers) + records (label-resolved cells) to CSV text. */
export function recordsToCsv(fields: DbField[], records: DbRecord[], members: DbMember[]): string {
  const header = fields.map((f) => csvEscape(f.name)).join(',')
  const lines = records.map((record) =>
    fields.map((f) => csvEscape(csvCell(f, record.values[f.id] ?? null, members))).join(',')
  )
  return [header, ...lines].join('\r\n')
}

/** Download CSV text as a `.csv` file. */
export function downloadCsv(filename: string, csv: string): void {
  // A BOM so Excel opens UTF-8 correctly.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/**
 * Parse CSV text into a 2D array of strings (RFC 4180: quoted fields, escaped quotes,
 * CRLF/LF). Small + dependency-free — good enough for a spreadsheet export/paste.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const chars = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  for (let i = 0; i < chars.length; i += 1) {
    const c = chars[i]
    if (inQuotes) {
      if (c === '"') {
        if (chars[i + 1] === '"') {
          field += '"'
          i += 1
        } else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  // Trailing field/row (no final newline).
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  // Drop a trailing empty line.
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''))
}
