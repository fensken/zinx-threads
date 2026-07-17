/** Read an image file and return a JPEG **data URL** downscaled so its longest side
 *  is at most `maxWidth`px, aspect preserved — for a locally-picked page **cover** (a
 *  wide banner, so no square crop). Kept off the network like the avatar. Throws for a
 *  non-image. */
export async function fileToCoverDataUrl(file: File, maxWidth = 1600): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('That file isn’t an image')
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, maxWidth / bitmap.width)
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not read the image')
    ctx.drawImage(bitmap, 0, 0, w, h)
    return canvas.toDataURL('image/jpeg', 0.82)
  } finally {
    bitmap.close()
  }
}

/** How large a non-image file may be to inline as a data URL in a **local** page. A data
 *  URL lives in the on-disk page JSON and is re-serialized on every save, so a big video
 *  would bloat every write — capped rather than unbounded. */
const LOCAL_EMBED_MAX = 8 * 1024 * 1024

/** Read ANY file into a **data URL** for local (offline) embedding in a page block —
 *  images are downscaled (reusing the cover path); other files (audio, pdf, …) are
 *  base64-inlined as-is, up to `LOCAL_EMBED_MAX`. The offline counterpart of the R2
 *  upload the online page editor uses; keeps everything on-device. */
export async function fileToDataUrl(file: File): Promise<string> {
  if (file.type.startsWith('image/')) return fileToCoverDataUrl(file)
  if (file.size > LOCAL_EMBED_MAX) {
    throw new Error('That file is too large to embed locally (max 8 MB)')
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Could not read that file'))
    reader.readAsDataURL(file)
  })
}

/** Read an image file and return a small, square JPEG **data URL** (downscaled to
 *  `size`px, cover-cropped), so a locally-picked avatar fits comfortably in
 *  localStorage — no upload / server needed. Throws for a non-image. */
export async function fileToAvatarDataUrl(file: File, size = 160): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('That file isn’t an image')
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not read the image')
    // Cover-crop to a centred square.
    const scale = Math.max(size / bitmap.width, size / bitmap.height)
    const w = bitmap.width * scale
    const h = bitmap.height * scale
    ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    bitmap.close()
  }
}
