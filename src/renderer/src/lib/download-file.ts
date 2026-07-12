import { platform } from '@renderer/lib/platform'

/** Save a remote file to disk. Fetches it as a blob and clicks a synthetic
 *  download link — cross-origin `<a download>` is ignored by browsers, so the
 *  blob round-trip is what actually forces a download. Falls back to opening the
 *  URL externally (where the user can save it) if the fetch is blocked. */
export async function downloadFile(url: string, name: string): Promise<void> {
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = name || 'download'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(objectUrl)
  } catch {
    platform.openExternal(url)
  }
}
