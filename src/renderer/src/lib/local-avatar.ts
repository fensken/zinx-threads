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
