import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { DownloadSimple, X } from '@phosphor-icons/react'
import { downloadFile } from '@renderer/lib/download-file'

/** Full-screen image viewer. Portaled to `document.body` so its `fixed` overlay
 *  escapes any transformed ancestor; Esc or a backdrop click closes it. Rendered
 *  only when `src` is set (the caller owns that state). */
export function ImageLightbox({
  src,
  name,
  onClose
}: {
  src: string
  name: string
  onClose: () => void
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <button
          type="button"
          title="Download"
          aria-label="Download"
          onClick={(event) => {
            event.stopPropagation()
            void downloadFile(src, name)
          }}
          className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <DownloadSimple className="size-5" />
        </button>
        <button
          type="button"
          title="Close"
          aria-label="Close"
          onClick={onClose}
          className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
        >
          <X className="size-5" />
        </button>
      </div>
      <img
        src={src}
        alt={name}
        onClick={(event) => event.stopPropagation()}
        className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
      />
    </div>,
    document.body
  )
}
