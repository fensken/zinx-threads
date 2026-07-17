import { useEffect, useRef } from 'react'
import { useLocalParticipant } from '@livekit/components-react'
import { useSettingsStore } from '@renderer/store/settings-store'
import { useVoiceStore } from '@renderer/store/voice-store'
import { keybindPressed, keybindReleased, parseKeybind } from '@renderer/lib/keybind'
import { playPttOffSound, playPttOnSound } from '@renderer/lib/sounds'

/** Don't fire PTT while the key is being typed into a text field. */
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

/**
 * Push-to-talk. While enabled (Settings → Audio & video), the mic stays **muted** and
 * only goes live while the bound key(s) are held — a single key or a combo (`Alt+K`, via
 * `lib/keybind.ts`). A soft blip plays as the mic opens and again as it closes. Mounted
 * inside the call by `VoiceCallProvider`; a no-op when PTT is off or no key is bound.
 * Deafen still wins. NOT yet runtime-verified (voice needs a live server + device).
 */
export function PushToTalkController(): null {
  const pushToTalk = useSettingsStore((s) => s.pushToTalk)
  const combo = useSettingsStore((s) => s.pushToTalkCombo)
  const { localParticipant } = useLocalParticipant()
  const deafened = useVoiceStore((s) => s.deafened)
  // Read at key-event time without re-binding the listeners on every deafen change.
  const deafenedRef = useRef(deafened)
  useEffect(() => {
    deafenedRef.current = deafened
  }, [deafened])

  useEffect(() => {
    const kb = parseKeybind(combo)
    if (!pushToTalk || !kb || !localParticipant) return
    // Enter PTT muted; the key opens the mic while held.
    void localParticipant.setMicrophoneEnabled(false)

    let held = false
    const down = (event: KeyboardEvent): void => {
      if (held || event.repeat || !keybindPressed(event, kb)) return
      if (isEditableTarget(event.target) || deafenedRef.current) return
      held = true
      void localParticipant.setMicrophoneEnabled(true)
      playPttOnSound()
    }
    const up = (event: KeyboardEvent): void => {
      if (!held || !keybindReleased(event, kb)) return
      held = false
      void localParticipant.setMicrophoneEnabled(false)
      playPttOffSound()
    }
    // A key can be released while the window is unfocused — `keyup` never fires, so the
    // mic would stick open. Close it on blur.
    const blur = (): void => {
      if (!held) return
      held = false
      void localParticipant.setMicrophoneEnabled(false)
      playPttOffSound()
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      // Leaving PTT mode (toggled off, or key changed): restore the mic so you're not
      // left silently muted — unless deafened, where the mic must stay closed.
      if (!deafenedRef.current) void localParticipant.setMicrophoneEnabled(true)
    }
  }, [pushToTalk, combo, localParticipant])

  return null
}
