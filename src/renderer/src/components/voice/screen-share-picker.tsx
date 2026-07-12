import { useEffect, useState } from 'react'
import { AppWindow, Monitor, type Icon } from '@phosphor-icons/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { Spinner } from '@renderer/components/ui/spinner'
import { platform, hasNativeBridge, type ScreenSource } from '@renderer/lib/platform'
import { cn } from '@renderer/lib/utils'

/** What the user chose to share + the quality they want. */
export interface ScreenShareOptions {
  audio: boolean
  resolution: { width: number; height: number; frameRate: number }
}

type Tab = 'apps' | 'screens'
type Quality = 'SD' | 'HD'

const RESOLUTIONS: Record<Quality, { width: number; height: number }> = {
  SD: { width: 1280, height: 720 },
  HD: { width: 1920, height: 1080 }
}
const FPS_OPTIONS = [15, 30, 60] as const

/** Discord-style "choose what to share" picker (desktop). Tabs switch between
 *  **Applications** (individual windows) and **Entire Screen** (whole displays) —
 *  live thumbnails from `desktopCapturer`, a hover "Share Screen" button on each,
 *  plus quality (SD/HD + fps) and an "also share audio" toggle. Web never opens this
 *  (the browser shows its own picker on getDisplayMedia). */
export function ScreenSharePicker({
  open,
  onOpenChange,
  onPick
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPick: (id: string, options: ScreenShareOptions) => void
}): React.JSX.Element {
  const [sources, setSources] = useState<ScreenSource[] | null>(null)
  const [tab, setTab] = useState<Tab>('apps')
  const [withAudio, setWithAudio] = useState(false)
  const [quality, setQuality] = useState<Quality>('HD')
  const [fps, setFps] = useState<number>(30)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void platform
      .getScreenSources()
      .then((result) => {
        if (!cancelled) setSources(result)
      })
      // Never leave the spinner spinning — an error shows the empty state instead.
      .catch(() => {
        if (!cancelled) setSources([])
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const screens = sources?.filter((source) => source.isScreen) ?? []
  const apps = sources?.filter((source) => !source.isScreen) ?? []
  const shown = tab === 'screens' ? screens : apps

  const pick = (id: string): void => {
    onPick(id, { audio: withAudio, resolution: { ...RESOLUTIONS[quality], frameRate: fps } })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSources(null)
        onOpenChange(next)
      }}
    >
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-3xl" showCloseButton={false}>
        <DialogHeader className="px-4 pt-4 pb-3">
          <DialogTitle>Screen Share</DialogTitle>
          <DialogDescription className="sr-only">
            Choose an application window or a whole screen to share with the call.
          </DialogDescription>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-2 px-4">
          <TabButton active={tab === 'apps'} onClick={() => setTab('apps')} icon={AppWindow}>
            Applications
          </TabButton>
          <TabButton active={tab === 'screens'} onClick={() => setTab('screens')} icon={Monitor}>
            Entire Screen
          </TabButton>
        </div>

        {/* Source grid */}
        <div className="no-scrollbar max-h-[55dvh] min-h-64 overflow-y-auto p-4">
          {sources === null ? (
            <div className="flex h-64 items-center justify-center">
              <Spinner className="size-6 text-muted-foreground" />
            </div>
          ) : shown.length === 0 ? (
            <p className="py-20 text-center text-sm text-muted-foreground">
              {!hasNativeBridge
                ? 'Screen sharing is unavailable — the desktop bridge didn’t load. Fully restart the app.'
                : tab === 'apps'
                  ? 'No open windows to share.'
                  : 'No screens available to share.'}
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {shown.map((source) => (
                <SourceCard key={source.id} source={source} onShare={() => pick(source.id)} />
              ))}
            </div>
          )}
        </div>

        {/* Footer: the audio note spans the full width (so it reads as ~2 lines, not a
            narrow column), with the quality controls on their own row below it. */}
        <div className="flex flex-col gap-3 border-t px-4 py-3">
          <label className="flex cursor-pointer items-start gap-2 text-sm select-none">
            <Checkbox
              checked={withAudio}
              className="mt-0.5"
              onCheckedChange={(checked) => setWithAudio(checked === true)}
            />
            <span className="leading-tight">
              Also share audio
              <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                Shares your computer’s entire system audio — everything currently playing, not just
                this window or app. Since that includes the call itself, other people may hear
                themselves echo back. Your microphone is separate and is never affected. Leave this
                off if you only want to share the picture.
              </span>
            </span>
          </label>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-muted-foreground">Quality</span>
            <div className="flex items-center gap-2">
              <Segmented
                options={['SD', 'HD'] as const}
                value={quality}
                onChange={setQuality}
                render={(q) => q}
              />
              <Segmented
                options={FPS_OPTIONS}
                value={fps}
                onChange={setFps}
                render={(f) => `${f}fps`}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function TabButton({
  active,
  onClick,
  icon: TabIcon,
  children
}: {
  active: boolean
  onClick: () => void
  icon: Icon
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-primary bg-primary/10 text-foreground'
          : 'border-transparent bg-muted/50 text-muted-foreground hover:bg-muted'
      )}
    >
      <TabIcon className="size-4" weight={active ? 'fill' : 'regular'} />
      {children}
    </button>
  )
}

function SourceCard({
  source,
  onShare
}: {
  source: ScreenSource
  onShare: () => void
}): React.JSX.Element {
  return (
    <div className="group flex flex-col gap-1.5">
      <button
        type="button"
        onClick={onShare}
        className="relative block aspect-video w-full overflow-hidden rounded-lg border bg-muted transition-colors hover:border-primary"
      >
        {source.thumbnail ? (
          <img src={source.thumbnail} alt="" className="size-full object-cover" />
        ) : (
          // No thumbnail (some GPU setups can't capture previews) — still shareable.
          <span className="flex size-full items-center justify-center text-muted-foreground">
            {source.isScreen ? (
              <Monitor className="size-8" weight="duotone" />
            ) : (
              <AppWindow className="size-8" weight="duotone" />
            )}
          </span>
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition-opacity group-hover:opacity-100">
          <span className="rounded-md bg-background px-3 py-1.5 text-sm font-semibold text-foreground shadow-lg">
            Share Screen
          </span>
        </div>
      </button>
      <span className="flex items-center gap-1.5 px-0.5 text-xs">
        {source.appIcon ? (
          <img src={source.appIcon} alt="" className="size-4 shrink-0" />
        ) : source.isScreen ? (
          <Monitor className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <AppWindow className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate">{source.name}</span>
      </span>
    </div>
  )
}

/** A compact segmented toggle (SD/HD, fps). */
function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  render
}: {
  options: readonly T[]
  value: T
  onChange: (value: T) => void
  render: (value: T) => string
}): React.JSX.Element {
  return (
    <div className="flex rounded-md border p-0.5">
      {options.map((option) => (
        <button
          key={String(option)}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            'rounded px-2.5 py-1 text-xs font-medium transition-colors',
            option === value
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {render(option)}
        </button>
      ))}
    </div>
  )
}
