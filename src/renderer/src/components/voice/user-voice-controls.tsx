import { useMaybeRoomContext, useMediaDeviceSelect } from '@livekit/components-react'
import {
  CaretDown,
  Check,
  Microphone,
  MicrophoneSlash,
  Monitor,
  PhoneDisconnect,
  PushPin,
  SpeakerHigh,
  VideoCamera,
  VideoCameraSlash,
  Waveform
} from '@phosphor-icons/react'
import { useVoiceStore } from '@renderer/store/voice-store'
import { useSettingsStore } from '@renderer/store/settings-store'
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

/** ONE consolidated voice-controls button in the user bar: a single trigger showing your
 *  live mic/deafen status, which opens a popover with the mic, camera and deafen toggles
 *  (+ device pickers) — instead of three inline buttons with carets. Discord-style.
 *
 *  With a room (real workspace) the toggles drive the live call, or set your persisted
 *  pre-call config when you're not in one; a mock build with no LiveKit falls back to the
 *  config toggles without device pickers. */
export function UserBarMediaButtons(): React.JSX.Element {
  const room = useMaybeRoomContext()
  return room ? <RoomMediaMenu /> : <PlainConfigMenu />
}

function RoomMediaMenu(): React.JSX.Element {
  const call = useVoiceStore((state) => state.call)
  const controls = useCallControls()
  const joinMuted = useVoiceStore((state) => state.joinMuted)
  const joinVideo = useVoiceStore((state) => state.joinVideo)
  const joinDeafened = useVoiceStore((state) => state.joinDeafened)
  const setJoinMuted = useVoiceStore((state) => state.setJoinMuted)
  const setJoinVideo = useVoiceStore((state) => state.setJoinVideo)
  const setJoinDeafened = useVoiceStore((state) => state.setJoinDeafened)

  const inCall = Boolean(call)
  return (
    <MediaMenu
      withDevices
      micOn={inCall ? controls.micOn : !(joinMuted || joinDeafened)}
      cameraOn={inCall ? controls.cameraOn : joinVideo}
      deafened={inCall ? controls.deafened : joinDeafened}
      micPending={inCall ? controls.micPending : false}
      cameraPending={inCall ? controls.cameraPending : false}
      onToggleMic={
        inCall
          ? controls.toggleMic
          : (): void => {
              if (joinDeafened) setJoinDeafened(false)
              setJoinMuted(!joinMuted)
            }
      }
      onToggleCamera={inCall ? controls.toggleCamera : (): void => setJoinVideo(!joinVideo)}
      onToggleDeafen={inCall ? controls.toggleDeafen : (): void => setJoinDeafened(!joinDeafened)}
    />
  )
}

/** Mock / no-LiveKit build: the persisted pre-call config toggles, without device pickers. */
function PlainConfigMenu(): React.JSX.Element {
  const joinMuted = useVoiceStore((state) => state.joinMuted)
  const joinVideo = useVoiceStore((state) => state.joinVideo)
  const joinDeafened = useVoiceStore((state) => state.joinDeafened)
  const setJoinMuted = useVoiceStore((state) => state.setJoinMuted)
  const setJoinVideo = useVoiceStore((state) => state.setJoinVideo)
  const setJoinDeafened = useVoiceStore((state) => state.setJoinDeafened)

  return (
    <MediaMenu
      micOn={!(joinMuted || joinDeafened)}
      cameraOn={joinVideo}
      deafened={joinDeafened}
      onToggleMic={(): void => {
        if (joinDeafened) setJoinDeafened(false)
        setJoinMuted(!joinMuted)
      }}
      onToggleCamera={(): void => setJoinVideo(!joinVideo)}
      onToggleDeafen={(): void => setJoinDeafened(!joinDeafened)}
    />
  )
}

/** The mic/camera trigger + popover, with **deafen as a standalone button beside it** —
 *  deafen is a one-tap "silence everything", so it stays outside the menu. The trigger
 *  shows your mic status at a glance (muted → red mic-slash, else mic); the popover holds
 *  the mic + camera toggles, each followed by its device list. */
function MediaMenu({
  micOn,
  cameraOn,
  deafened,
  micPending,
  cameraPending,
  withDevices,
  onToggleMic,
  onToggleCamera,
  onToggleDeafen
}: {
  micOn: boolean
  cameraOn: boolean
  deafened: boolean
  micPending?: boolean
  cameraPending?: boolean
  withDevices?: boolean
  onToggleMic: () => void
  onToggleCamera: () => void
  onToggleDeafen: () => void
}): React.JSX.Element {
  const pushToTalk = useSettingsStore((state) => state.pushToTalk)
  const setPushToTalk = useSettingsStore((state) => state.setPushToTalk)
  const pttLabel = useSettingsStore((state) => state.pushToTalkLabel)

  return (
    <>
      <Popover>
        <Tip label={pushToTalk ? 'Voice controls · Push to talk' : 'Voice controls'}>
          <PopoverTrigger
            aria-label="Voice controls"
            className={cn(
              'flex h-8 items-center gap-0.5 rounded-md px-1.5 transition-colors',
              micOn
                ? 'text-muted-foreground hover:bg-accent hover:text-foreground'
                : 'text-destructive hover:bg-destructive/10'
            )}
          >
            {micOn ? <Microphone className="size-4" /> : <MicrophoneSlash className="size-4" />}
            {/* Tell normal mode apart from push-to-talk at a glance. */}
            {pushToTalk ? (
              <span className="text-[9px] font-bold tracking-wide text-primary">PTT</span>
            ) : null}
            <CaretDown className="size-3" weight="bold" />
          </PopoverTrigger>
        </Tip>
        <PopoverContent side="top" align="end" sideOffset={8} className="w-64 p-1">
          <MenuToggleRow
            label="Microphone"
            state={micOn ? 'On' : 'Muted'}
            active={micOn}
            danger={!micOn}
            pending={micPending}
            onClick={onToggleMic}
          >
            {micOn ? <Microphone className="size-4" /> : <MicrophoneSlash className="size-4" />}
          </MenuToggleRow>
          {withDevices ? <DeviceOptions kind="audioinput" label="microphone" /> : null}

          <MenuDivider />

          <MenuToggleRow
            label="Camera"
            state={cameraOn ? 'On' : 'Off'}
            active={cameraOn}
            danger={!cameraOn}
            pending={cameraPending}
            onClick={onToggleCamera}
          >
            {cameraOn ? (
              <VideoCamera className="size-4" />
            ) : (
              <VideoCameraSlash className="size-4" />
            )}
          </MenuToggleRow>
          {withDevices ? <DeviceOptions kind="videoinput" label="camera" /> : null}

          {withDevices ? (
            <>
              <MenuDivider />
              <div className="flex items-center gap-2.5 px-2 py-1.5 text-sm">
                <span className="flex size-4 shrink-0 items-center justify-center">
                  <SpeakerHigh className="size-4" />
                </span>
                <span className="flex-1 font-medium">Speaker</span>
              </div>
              <DeviceOptions kind="audiooutput" label="speaker" />
            </>
          ) : null}

          <MenuDivider />

          {/* Quick input-mode switch — flip push-to-talk on/off without opening Settings. */}
          <MenuToggleRow
            label="Push to talk"
            state={pushToTalk ? pttLabel || 'On' : 'Off'}
            active={pushToTalk}
            onClick={() => setPushToTalk(!pushToTalk)}
          >
            <PushPin className="size-4" weight={pushToTalk ? 'fill' : 'regular'} />
          </MenuToggleRow>
        </PopoverContent>
      </Popover>

      {/* Deafen — its own button (one tap to silence everything), red when active. */}
      <Tip label={deafened ? 'Undeafen' : 'Deafen'}>
        <button
          type="button"
          aria-label={deafened ? 'Undeafen' : 'Deafen'}
          aria-pressed={deafened}
          onClick={onToggleDeafen}
          className={cn(
            'flex size-8 items-center justify-center rounded-md transition-colors',
            deafened
              ? 'text-destructive hover:bg-destructive/10'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
        >
          <DeafenGlyph deafened={deafened} className="size-4" />
        </button>
      </Tip>
    </>
  )
}

/** A full-width toggle row: icon + label + a trailing state word. Clicking toggles it. */
function MenuToggleRow({
  label,
  state,
  active,
  danger,
  pending,
  onClick,
  children
}: {
  label: string
  state: string
  active?: boolean
  danger?: boolean
  pending?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      disabled={pending}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-50',
        danger ? 'text-destructive' : 'text-foreground'
      )}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{children}</span>
      <span className="flex-1 text-left font-medium">{label}</span>
      <span className={cn('text-xs', danger ? 'text-destructive' : 'text-muted-foreground')}>
        {state}
      </span>
    </button>
  )
}

/** The input-device list for a mic/camera, indented under its toggle. Hidden when there's
 *  nothing to choose (0 or 1 device). Needs a room (LiveKit device access). */
function DeviceOptions({
  kind,
  label
}: {
  kind: 'audioinput' | 'audiooutput' | 'videoinput'
  label: string
}): React.JSX.Element | null {
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({ kind })
  if (devices.length <= 1) return null
  return (
    <div className="mt-0.5 mb-1 pl-2">
      {devices.map((device, index) => (
        <button
          key={device.deviceId || index}
          type="button"
          onClick={() => void setActiveMediaDevice(device.deviceId)}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Check
            className={cn(
              'size-3.5 shrink-0',
              device.deviceId === activeDeviceId ? 'text-primary opacity-100' : 'opacity-0'
            )}
            weight="bold"
          />
          <span className="truncate">{device.label || `${label} ${index + 1}`}</span>
        </button>
      ))}
    </div>
  )
}

function MenuDivider(): React.JSX.Element {
  return <div className="my-1 h-px bg-border" />
}
