import type { TrackReferenceOrPlaceholder } from '@livekit/components-react'

/** Two track references point at the same thing when it's the same participant +
 *  source (avoids depending on `@livekit/components-core`'s `isEqualTrackRef`).
 *  Shared by the call stage (voice-room) and the tiles (voice-tile). */
export function sameTrack(
  a?: TrackReferenceOrPlaceholder,
  b?: TrackReferenceOrPlaceholder
): boolean {
  if (!a || !b) return false
  return a.participant.identity === b.participant.identity && a.source === b.source
}
