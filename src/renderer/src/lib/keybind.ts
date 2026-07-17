/**
 * A keyboard shortcut — a key `code` plus which modifiers must be held. Used for the
 * push-to-talk binding, which can be a single key (`Space`) or a combo (`Alt + K`).
 */
export interface Keybind {
  code: string
  alt: boolean
  ctrl: boolean
  shift: boolean
  meta: boolean
}

const MODIFIER_RE = /^(Alt|Control|Shift|Meta)(Left|Right)$/

/** Is this `KeyboardEvent.code` a bare modifier (Alt/Ctrl/Shift/Meta)? */
export function isModifierCode(code: string): boolean {
  return MODIFIER_RE.test(code)
}

/** `{code:'KeyK', alt:true}` → `"alt+KeyK"` — the stored form. */
export function serializeKeybind(kb: Keybind): string {
  const parts: string[] = []
  if (kb.ctrl) parts.push('ctrl')
  if (kb.alt) parts.push('alt')
  if (kb.shift) parts.push('shift')
  if (kb.meta) parts.push('meta')
  parts.push(kb.code)
  return parts.join('+')
}

/** The inverse of `serializeKeybind`; null for an empty/garbage value. */
export function parseKeybind(value: string | null | undefined): Keybind | null {
  if (!value) return null
  const parts = value.split('+')
  const code = parts.pop()
  if (!code) return null
  const mods = new Set(parts)
  return {
    code,
    alt: mods.has('alt'),
    ctrl: mods.has('ctrl'),
    shift: mods.has('shift'),
    meta: mods.has('meta')
  }
}

function codeLabel(code: string): string {
  const named: Record<string, string> = {
    Space: 'Space',
    Backquote: '`',
    Enter: 'Enter',
    Tab: 'Tab',
    CapsLock: 'Caps Lock',
    AltLeft: 'Alt',
    AltRight: 'Alt',
    ControlLeft: 'Ctrl',
    ControlRight: 'Ctrl',
    ShiftLeft: 'Shift',
    ShiftRight: 'Shift',
    MetaLeft: 'Meta',
    MetaRight: 'Meta'
  }
  if (named[code]) return named[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`
  if (/^F\d+$/.test(code)) return code
  return code
}

/** A human label: `{code:'KeyK', alt:true}` → `"Alt + K"`. */
export function keybindLabel(kb: Keybind): string {
  const parts: string[] = []
  if (kb.ctrl) parts.push('Ctrl')
  if (kb.alt) parts.push('Alt')
  if (kb.shift) parts.push('Shift')
  if (kb.meta) parts.push('Meta')
  // A bare-modifier bind (its code IS the modifier) — don't repeat it.
  if (!isModifierCode(kb.code)) parts.push(codeLabel(kb.code))
  else if (parts.length === 0) parts.push(codeLabel(kb.code))
  return parts.join(' + ')
}

/** Are the modifiers this bind requires currently held (per a `KeyboardEvent`)? */
function modifiersHeld(event: KeyboardEvent, kb: Keybind): boolean {
  return (
    (!kb.alt || event.altKey) &&
    (!kb.ctrl || event.ctrlKey) &&
    (!kb.shift || event.shiftKey) &&
    (!kb.meta || event.metaKey)
  )
}

/** Does this keydown BEGIN the bind (its key + required modifiers)? */
export function keybindPressed(event: KeyboardEvent, kb: Keybind): boolean {
  return event.code === kb.code && modifiersHeld(event, kb)
}

/** Does this keyup END the bind — either the main key, or one of its required
 *  modifiers, was released? */
export function keybindReleased(event: KeyboardEvent, kb: Keybind): boolean {
  if (event.code === kb.code) return true
  if (kb.alt && (event.code === 'AltLeft' || event.code === 'AltRight')) return true
  if (kb.ctrl && (event.code === 'ControlLeft' || event.code === 'ControlRight')) return true
  if (kb.shift && (event.code === 'ShiftLeft' || event.code === 'ShiftRight')) return true
  if (kb.meta && (event.code === 'MetaLeft' || event.code === 'MetaRight')) return true
  return false
}
