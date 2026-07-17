import { useEffect, useState } from 'react'
import { Keyboard, Microphone, PushPin, SpeakerHigh, VideoCamera } from '@phosphor-icons/react'
import { useSettingsStore } from '@renderer/store/settings-store'
import { useVoiceStore } from '@renderer/store/voice-store'
import { useMediaDeviceList, type MediaDeviceKind } from '@renderer/lib/media-devices'
import { isModifierCode, keybindLabel, serializeKeybind } from '@renderer/lib/keybind'
import { Button } from '@renderer/components/ui/button'
import { Label } from '@renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { cn } from '@renderer/lib/utils'

const DEFAULT_VALUE = '__default__'

/** Audio & video settings — device selection (mic / speaker / camera) + the voice input
 *  mode (voice-activity vs push-to-talk, with a recordable **combo** key). Client-side
 *  prefs applied to the call by `voice/device-applier.tsx` + `push-to-talk-controller.tsx`. */
export function VoiceSettings(): React.JSX.Element {
  const micDeviceId = useVoiceStore((s) => s.micDeviceId)
  const speakerDeviceId = useVoiceStore((s) => s.speakerDeviceId)
  const cameraDeviceId = useVoiceStore((s) => s.cameraDeviceId)
  const setMicDeviceId = useVoiceStore((s) => s.setMicDeviceId)
  const setSpeakerDeviceId = useVoiceStore((s) => s.setSpeakerDeviceId)
  const setCameraDeviceId = useVoiceStore((s) => s.setCameraDeviceId)

  return (
    <div className="grid gap-6">
      <section>
        <h3 className="text-sm font-semibold">Devices</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Which microphone, speaker and camera calls use.
        </p>
        <div className="grid gap-4">
          <DeviceSelect
            kind="audioinput"
            Icon={Microphone}
            label="Microphone"
            value={micDeviceId}
            onChange={setMicDeviceId}
          />
          <DeviceSelect
            kind="audiooutput"
            Icon={SpeakerHigh}
            label="Speaker"
            value={speakerDeviceId}
            onChange={setSpeakerDeviceId}
          />
          <DeviceSelect
            kind="videoinput"
            Icon={VideoCamera}
            label="Camera"
            value={cameraDeviceId}
            onChange={setCameraDeviceId}
          />
        </div>
      </section>

      <InputModeSection />
    </div>
  )
}

function DeviceSelect({
  kind,
  Icon,
  label,
  value,
  onChange
}: {
  kind: MediaDeviceKind
  Icon: typeof Microphone
  label: string
  value: string
  onChange: (deviceId: string) => void
}): React.JSX.Element {
  const devices = useMediaDeviceList(kind)
  const items: Record<string, string> = { [DEFAULT_VALUE]: 'Default (system)' }
  devices.forEach((device, index) => {
    if (device.deviceId) items[device.deviceId] = device.label || `${label} ${index + 1}`
  })
  // A previously-picked device that's now unplugged falls back to the default label.
  const current = value && items[value] ? value : DEFAULT_VALUE

  return (
    <div className="grid gap-1.5">
      <Label className="flex items-center gap-1.5">
        <Icon className="size-3.5 text-muted-foreground" weight="duotone" />
        {label}
      </Label>
      <Select
        items={items}
        value={current}
        onValueChange={(next) => onChange(next && next !== DEFAULT_VALUE ? next : '')}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(items).map(([val, lbl]) => (
            <SelectItem key={val} value={val}>
              {lbl}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function InputModeSection(): React.JSX.Element {
  const pushToTalk = useSettingsStore((s) => s.pushToTalk)
  const setPushToTalk = useSettingsStore((s) => s.setPushToTalk)
  const combo = useSettingsStore((s) => s.pushToTalkCombo)
  const label = useSettingsStore((s) => s.pushToTalkLabel)
  const setKey = useSettingsStore((s) => s.setPushToTalkKey)
  const [recording, setRecording] = useState(false)

  // Record a key OR a combo (Alt+K). Modifiers alone don't finalise — we wait for the
  // full chord: a non-modifier keydown captures the held modifiers; a lone modifier is
  // captured on its keyup (so "just Alt" works too). Esc cancels.
  useEffect(() => {
    if (!recording) return
    let done = false
    const finish = (kb: {
      code: string
      alt: boolean
      ctrl: boolean
      shift: boolean
      meta: boolean
    }): void => {
      if (done) return
      done = true
      setKey(serializeKeybind(kb), keybindLabel(kb))
      setRecording(false)
    }
    const onDown = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        done = true
        setRecording(false)
        return
      }
      if (isModifierCode(event.code)) return
      finish({
        code: event.code,
        alt: event.altKey,
        ctrl: event.ctrlKey,
        shift: event.shiftKey,
        meta: event.metaKey
      })
    }
    const onUp = (event: KeyboardEvent): void => {
      if (done || !isModifierCode(event.code)) return
      finish({ code: event.code, alt: false, ctrl: false, shift: false, meta: false })
    }
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
    }
  }, [recording, setKey])

  return (
    <section>
      <h3 className="text-sm font-semibold">Input mode</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        How your microphone behaves in a voice call.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <ModeCard
          active={!pushToTalk}
          onClick={() => setPushToTalk(false)}
          Icon={Microphone}
          title="Voice activity"
          description="Your mic is always live while unmuted."
        />
        <ModeCard
          active={pushToTalk}
          onClick={() => setPushToTalk(true)}
          Icon={PushPin}
          title="Push to talk"
          description="Muted until you hold a key."
        />
      </div>

      {pushToTalk ? (
        <div className="mt-6 grid gap-1.5">
          <Label className="flex items-center gap-1.5">
            <Keyboard className="size-3.5 text-muted-foreground" weight="duotone" />
            Push-to-talk shortcut
          </Label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRecording(true)}
              className={cn(
                'flex h-9 flex-1 items-center justify-center rounded-md border text-sm font-medium transition-colors',
                recording
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-input hover:bg-accent/40'
              )}
            >
              {recording ? 'Press a key or combo…' : label ? label : 'Not set'}
            </button>
            {combo && !recording ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setKey('', '')}>
                Clear
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {combo
              ? 'Hold this while in a call to unmute; release to mute. A combo like Alt + K works.'
              : 'Record a key (or a combo like Alt + K) to use push to talk.'}
          </p>
        </div>
      ) : null}
    </section>
  )
}

function ModeCard({
  active,
  onClick,
  Icon,
  title,
  description
}: {
  active: boolean
  onClick: () => void
  Icon: typeof Microphone
  title: string
  description: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-start gap-1 rounded-lg border-2 p-3 text-left transition-colors',
        active
          ? 'border-primary bg-primary/10'
          : 'border-border hover:border-muted-foreground/40 hover:bg-accent'
      )}
    >
      <Icon
        className={cn('size-5', active ? 'text-primary' : 'text-muted-foreground')}
        weight={active ? 'fill' : 'regular'}
      />
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </button>
  )
}
