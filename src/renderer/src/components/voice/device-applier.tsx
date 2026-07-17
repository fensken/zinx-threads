import { useEffect } from 'react'
import { useRoomContext } from '@livekit/components-react'
import { useVoiceStore } from '@renderer/store/voice-store'

/**
 * Applies the **persisted device selection** (Settings → Audio & video) to the live
 * call: microphone (`audioinput`), speaker (`audiooutput`), and camera (`videoinput`).
 * An empty id means "leave the system default". Mounted inside the call by
 * `VoiceCallProvider`, so switching a device in settings takes effect immediately.
 * NOT yet runtime-verified (voice needs a live LiveKit server + real devices).
 */
export function DeviceApplier(): null {
  const room = useRoomContext()
  const micDeviceId = useVoiceStore((s) => s.micDeviceId)
  const speakerDeviceId = useVoiceStore((s) => s.speakerDeviceId)
  const cameraDeviceId = useVoiceStore((s) => s.cameraDeviceId)

  useEffect(() => {
    if (micDeviceId) void room.switchActiveDevice('audioinput', micDeviceId).catch(() => {})
  }, [room, micDeviceId])
  useEffect(() => {
    if (speakerDeviceId)
      void room.switchActiveDevice('audiooutput', speakerDeviceId).catch(() => {})
  }, [room, speakerDeviceId])
  useEffect(() => {
    if (cameraDeviceId) void room.switchActiveDevice('videoinput', cameraDeviceId).catch(() => {})
  }, [room, cameraDeviceId])

  return null
}
