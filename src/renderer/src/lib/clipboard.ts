/**
 * Copy text to the clipboard, reliably across web AND Electron desktop.
 *
 * The async Clipboard API (`navigator.clipboard.writeText`) is preferred, but it can
 * fail *silently*: it needs a secure context and, in Electron, the
 * `clipboard-sanitized-write` permission — a denied permission **rejects** the
 * promise (this app's main-process permission handler must allow it). So we fall
 * back to the legacy `document.execCommand('copy')` (a hidden textarea), which works
 * from a user gesture without any permission and covers older/locked-down contexts.
 *
 * Returns whether the copy succeeded so the caller can show a check / error toast —
 * never assume it worked.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Permission denied or insecure context — try the execCommand fallback below.
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    // Keep it off-screen and inert so selecting it doesn't scroll or flash.
    textarea.style.position = 'fixed'
    textarea.style.top = '-9999px'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}
