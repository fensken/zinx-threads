import { MediaPlayer as VidstackPlayer, MediaProvider } from '@vidstack/react'
import {
  DefaultAudioLayout,
  DefaultVideoLayout,
  defaultLayoutIcons
} from '@vidstack/react/player/layouts/default'
import { cn } from '@renderer/lib/utils'

import '@vidstack/react/player/styles/default/theme.css'
import '@vidstack/react/player/styles/default/layouts/audio.css'
import '@vidstack/react/player/styles/default/layouts/video.css'
import '@renderer/components/common/media-player.css'

/**
 * A Vidstack audio/video player themed to our tokens — the ONE player, shared by the page
 * editor's media blocks AND chat message attachments (ported from `_zinx`'s `video-player.tsx`).
 *
 * **It's heavy (Vidstack ~300 kB).** The page editor is already a lazy chunk, so it imports this
 * directly; chat is in the main bundle, so `message-attachments.tsx` must `React.lazy` it — that
 * keeps Vidstack out of the main bundle and loads it only when a message actually has audio/video.
 * A `default` export makes the `React.lazy(() => import(...))` call clean.
 */
export function MediaPlayer({
  kind,
  src,
  title,
  className
}: {
  kind: 'audio' | 'video'
  src: string
  title?: string
  className?: string
}): React.JSX.Element {
  return (
    <VidstackPlayer
      className={cn('zinx-media-player', `zinx-media-player-${kind}`, className)}
      src={src}
      viewType={kind}
      title={title || undefined}
      playsInline
      volume={0.6}
    >
      <MediaProvider />
      {kind === 'audio' ? (
        <DefaultAudioLayout icons={defaultLayoutIcons} />
      ) : (
        // No Cast / AirPlay in a desktop/web app — drop those slots.
        <DefaultVideoLayout
          icons={defaultLayoutIcons}
          slots={{ googleCastButton: null, airPlayButton: null }}
        />
      )}
    </VidstackPlayer>
  )
}

export default MediaPlayer
