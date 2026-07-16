/**
 * Reading and writing an Excalidraw scene.
 *
 * The scene is stored as a JSON **string** of Excalidraw's element array — the same
 * call as `pages.content` and `messages.body`: the shapes are Excalidraw's, they
 * change with its version, and nothing server-side reads inside them.
 */

/** Elements are Excalidraw's own type; we only ever pass them straight back to it.
 *  `unknown[]` rather than `any[]` — we genuinely don't inspect them. */
export type SceneElements = readonly unknown[]

/**
 * Parse a stored scene, defensively.
 *
 * A partial write, a migration, or a hand-edit can leave this malformed — and parsing
 * inline in a render path (`JSON.parse(elements)`) would **throw and blank the whole
 * page**, not just the diagram. (`_zinx` learned this one; its `safeExcalidrawInitialData`
 * is the same guard.) A corrupt scene opens as an empty canvas instead.
 */
export function parseScene(elements: string | null | undefined): SceneElements {
  if (!elements) return []
  try {
    const parsed: unknown = JSON.parse(elements)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Serialize for storage, dropping Excalidraw's soft-deleted elements — it keeps
 *  them in memory for undo, but persisting tombstones grows the scene forever. */
export function serializeScene(elements: SceneElements): { json: string; count: number } {
  const live = (elements as Array<{ isDeleted?: boolean }>).filter((element) => !element?.isDeleted)
  return { json: JSON.stringify(live), count: live.length }
}
