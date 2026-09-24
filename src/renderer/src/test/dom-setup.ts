/**
 * jsdom shims for the `editor` test project.
 *
 * jsdom's `localStorage` isn't present under vitest's default flags, and Vidstack reads it
 * at module scope — so importing the media player (which the doc editor's media blocks do)
 * throws before a single test runs. A tiny in-memory implementation is enough; nothing here
 * asserts on storage.
 */
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage.getItem) {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size
      }
    }
  })
}

// ProseMirror measures ranges when placing decorations and the drag handle; jsdom has no
// layout, so it returns nothing rather than throwing.
if (typeof Range !== 'undefined' && !Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Range.prototype.getClientRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: () => [][Symbol.iterator]()
    }) as unknown as DOMRectList
}
