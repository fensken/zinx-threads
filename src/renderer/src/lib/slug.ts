/** Loose live slug normalisation for an input as the user types — lowercase, collapse
 *  runs of invalid characters to single hyphens, cap length. Final validation (leading/
 *  trailing hyphens, reserved words, uniqueness) is server-side. */
export function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, 40)
}
