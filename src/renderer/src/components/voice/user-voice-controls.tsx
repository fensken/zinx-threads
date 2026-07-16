import { useMaybeRoomContext, useMediaDeviceSelect } from '@livekit/components-react'
import {
  CaretDown,
  Check,
  Microphone,
  MicrophoneSlash,
  Monitor,
  PhoneDisconnect,
  VideoCamera,
  VideoCameraSlash,
  Waveform
} from '@phosphor-icons/react'
import { useVoiceStore } from '@renderer/store/voice-store'
import { useCallControls } from '@renderer/components/voice/use-call-controls'
import { ScreenSharePicker } from '@renderer/components/voice/screen-share-picker'
import { DeafenGlyph } from '@renderer/components/voice/deafen-glyph'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { Tip } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'

// The mic / deafen / camera / screen-share controls that live in the floating user
// bar — wired to the SAME LiveKit room the call renders, so the bar reflects and
// controls the actual call (Discord-style). All of these only render once you're in
// a call (a room context exists); before that the bar shows plain buttons.

/** The green "Voice Connected" strip shown above the user bar while in a call:
 *  channel name, camera + screen-share toggles, and disconnect. Renders nothing
 *  when not in a call. */
export function VoiceConnectedStrip(): React.JSX.Element | null {
  const room = useMaybeRoomContext()
  const call = useVoiceStore((state) => state.call)
  if (!room || !call) return null
  return <VoiceConnectedStripContent channelName={call.channelName} />
}

function VoiceConnectedStripContent({ channelName }: { channelName: string }): React.JSX.Element {
  const controls = useCallControls()

  return (
    <div className="mx-2 mt-2 rounded-lg bg-sidebar-accent/40 px-2 py-2">
      <div className="flex items-center gap-2">
        <Waveform className="size-4 shrink-0 text-success" weight="bold" />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-xs font-semibold text-success">Voice Connected</div>
          <div className="truncate text-xs text-muted-foreground">{channelName}</div>
        </div>
        <Tip label="Disconnect">
          <button
            type="button"
            aria-label="Disconnect"
            onClick={controls.leave}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
          >
            <PhoneDisconnect className="size-4" weight="fill" />
          </button>
        </Tip>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1">
        <StripButton
          active={controls.cameraOn}
          pending={controls.cameraPending}
          onClick={controls.toggleCamera}
          label={controls.cameraOn ? 'Stop video' : 'Start video'}
        >
          {controls.cameraOn ? (
            <VideoCamera className="size-4" weight="fill" />
          ) : (
            <VideoCameraSlash className="size-4" />
          )}
          Video
        </StripButton>
        <StripButton
          active={controls.screenOn}
          pending={controls.screenPending}
          onClick={controls.toggleScreenShare}
          label={controls.screenOn ? 'Stop sharing' : 'Share screen'}
        >
          <Monitor className="size-4" weight={controls.screenOn ? 'fill' : 'regular'} />
          Screen
        </StripButton>
      </div>
      <ScreenSharePicker
        open={controls.screenPickerOpen}
        onOpenChange={controls.setScreenPickerOpen}
        onPick={controls.pickScreenSource}
      />
    </div>
  )
}

function StripButton({
  active,
  pending,
  onClick,
  label,
  children
}: {
  active?: boolean
  pending?: boolean
  onClick: () => void
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        disabled={pending}
        onClick={onClick}
        className={cn(
          'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
          active
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'bg-sidebar-accent/60 text-foreground hover:bg-sidebar-accent'
        )}
      >
        {children}
      </button>
    </Tip>
  )
}

/** The mic + camera + deafen buttons for the user-bar identity row, each with a
 *  device picker. With a room (real workspace) they drive the live call OR — when
 *  you're not in one — set your persisted pre-call config; a mock build with no
 *  LiveKit falls back to plain config toggles (no device pickers). */
export function UserBarMediaButtons(): React.JSX.Element {
  const room = useMaybeRoomContext()
  return room ? <RoomMediaButtons /> : <PlainConfigButtons />
}

function RoomMediaButtons(): React.JSX.Element {
  const call = useVoiceStore((state) => state.call)
  const controls = useCallControls()
  const joinMuted = useVoiceStore((state) => state.joinMuted)
  const joinVideo = useVoiceStore((state) => state.joinVideo)
  const joinDeafened = useVoiceStore((state) => state.joinDeafened)
  const setJoinMuted = useVoiceStore((state) => state.setJoinMuted)
  const setJoinVideo = useVoiceStore((state) => state.setJoinVideo)
  const setJoinDeafened = useVoiceStore((state) => state.setJoinDeafened)

  // In a call the buttons control the live room; otherwise they set the pre-call
  // config (applied on your next join). Device pickers work in both states.
  const inCall = Boolean(call)
  const micOn = inCall ? controls.micOn : !(joinMuted || joinDeafened)
  const cameraOn = inCall ? controls.cameraOn : joinVideo
  const deafened = inCall ? controls.deafened : joinDeafened

  const toggleMic = inCall
    ? controls.toggleMic
    : (): void => {
        if (joinDeafened) setJoinDeafened(false)
        setJoinMuted(!joinMuted)
      }
  const toggleCamera = inCall ? controls.toggleCamera : (): void => setJoinVideo(!joinVideo)
  const toggleDeafen = inCall ? controls.toggleDeafen : (): void => setJoinDeafened(!joinDeafened)

  return (
    <>
      <MediaButtonWithDevices
        kind="audioinput"
        active={micOn}
        pending={inCall ? controls.micPending : false}
        onToggle={toggleMic}
        onIcon={<Microphone className="size-4" />}
        offIcon={<MicrophoneSlash className="size-4" />}
        label="Microphone"
        dangerWhenOff
      />
      <MediaButtonWithDevices
        kind="videoinput"
        active={cameraOn}
        pending={inCall ? controls.cameraPending : false}
        onToggle={toggleCamera}
        onIcon={<VideoCamera className="size-4" />}
        offIcon={<VideoCameraSlash className="size-4" />}
        label="Camera"
        dangerWhenOff
      />
      <IconToggle
        label={deafened ? 'Undeafen' : 'Deafen'}
        active={deafened}
        danger={deafened}
        onClick={toggleDeafen}
      >
        <DeafenGlyph deafened={deafened} className="size-4" />
      </IconToggle>
    </>
  )
}

/** Mock / no-LiveKit build: just the persisted pre-call config toggles, without the
 *  device pickers (which need a room). */
function PlainConfigButtons(): React.JSX.Element {
  const joinMuted = useVoiceStore((state) => state.joinMuted)
  const joinVideo = useVoiceStore((state) => state.joinVideo)
  const joinDeafened = useVoiceStore((state) => state.joinDeafened)
  const setJoinMuted = useVoiceStore((state) => state.setJoinMuted)
  const setJoinVideo = useVoiceStore((state) => state.setJoinVideo)
  const setJoinDeafened = useVoiceStore((state) => state.setJoinDeafened)
  const micOff = joinMuted || joinDeafened

  return (
    <>
      <IconToggle
        label={micOff ? 'Join unmuted' : 'Join muted'}
        active={micOff}
        danger={micOff}
        onClick={() => {
          if (joinDeafened) setJoinDeafened(false)
          setJoinMuted(!joinMuted)
        }}
      >
        {micOff ? <MicrophoneSlash className="size-4" /> : <Microphone className="size-4" />}
      </IconToggle>
      <IconToggle
        label={joinVideo ? 'Join without camera' : 'Join with camera'}
        active={joinVideo}
        danger={!joinVideo}
        onClick={() => setJoinVideo(!joinVideo)}
      >
        {joinVideo ? <VideoCamera className="size-4" /> : <VideoCameraSlash className="size-4" />}
      </IconToggle>
      <IconToggle
        label={joinDeafened ? 'Join undeafened' : 'Join deafened'}
        active={joinDeafened}
        danger={joinDeafened}
        onClick={() => setJoinDeafened(!joinDeafened)}
      >
        <DeafenGlyph deafened={joinDeafened} className="size-4" />
      </IconToggle>
    </>
  )
}

/** A media toggle (mic/camera) + a caret that opens the list of input devices of
 *  `kind`, so a user with several mics/cameras can pick which is live from the bar. */
function MediaButtonWithDevices({
  kind,
  active,
  pending,
  onToggle,
  onIcon,
  offIcon,
  label,
  dangerWhenOff
}: {
  kind: 'audioinput' | 'videoinput'
  active: boolean
  pending?: boolean
  onToggle: () => void
  onIcon: React.ReactNode
  offIcon: React.ReactNode
  label: string
  /** Show the button red when off (mic-muted style). Camera-off stays neutral. */
  dangerWhenOff?: boolean
}): React.JSX.Element {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind })

  return (
    <div className="flex items-center">
      <IconToggle
        label={label}
        active={active}
        danger={dangerWhenOff && !active}
        onClick={onToggle}
        disabled={pending}
      >
        {active ? onIcon : offIcon}
      </IconToggle>
      <Popover>
        <Tip label={`Choose ${label.toLowerCase()}`}>
          <PopoverTrigger
            aria-label={`Choose ${label.toLowerCase()}`}
            className="flex h-8 items-center rounded-md px-0.5 text-muted-foreground hover:text-foreground"
          >
            <CaretDown className="size-3" weight="bold" />
          </PopoverTrigger>
        </Tip>
        <PopoverContent side="top" align="start" className="w-64 p-1">
          <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">{label}</p>
          {devices.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">No devices found.</p>
          ) : (
            devices.map((device, index) => (
              <button
                key={device.deviceId || index}
                type="button"
                onClick={() => void setActiveMediaDevice(device.deviceId)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <Check
                  className={cn(
                    'size-4 shrink-0',
                    device.deviceId === activeDeviceId ? 'opacity-100' : 'opacity-0'
                  )}
                  weight="bold"
                />
                <span className="truncate">{device.label || `${label} ${index + 1}`}</span>
              </button>
            ))
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}

function IconToggle({
  label,
  active,
  danger,
  disabled,
  onClick,
  children
}: {
  label: string
  active?: boolean
  danger?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tip label={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'flex size-8 items-center justify-center rounded-md transition-colors disabled:opacity-50',
          danger
            ? 'text-destructive hover:bg-destructive/10'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        )}
      >
        {children}
      </button>
    </Tip>
  )
}
