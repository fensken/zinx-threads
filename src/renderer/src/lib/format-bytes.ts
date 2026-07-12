const UNITS = ['B', 'KB', 'MB', 'GB'] as const

/** A short human file size — `840 KB`, `2.3 MB`. Used on attachment chips. */
export function formatBytes(bytes: number): string {
  if (bytes < 1) return '0 B'
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  const value = bytes / 1024 ** exponent
  // No decimal for plain bytes; one for KB+.
  return `${exponent === 0 ? Math.round(value) : value.toFixed(1)} ${UNITS[exponent]}`
}
