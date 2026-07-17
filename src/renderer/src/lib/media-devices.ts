import { useEffect, useState } from 'react'

export type MediaDeviceKind = 'audioinput' | 'audiooutput' | 'videoinput'

/**
 * Enumerate the media devices of one kind (mic / speaker / camera). Device **labels**
 * are only populated once the page has been granted media permission — before that the
 * list still has the devices, just with blank names (the caller falls back to "Device N").
 * Re-lists on `devicechange` (a device plugged in/out). `[]` where the API is unavailable.
 */
export function useMediaDeviceList(kind: MediaDeviceKind): MediaDeviceInfo[] {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

  useEffect(() => {
    const md = navigator.mediaDevices
    if (!md?.enumerateDevices) return
    let alive = true
    const refresh = (): void => {
      void md
        .enumerateDevices()
        .then((all) => {
          if (alive) setDevices(all.filter((device) => device.kind === kind))
        })
        .catch(() => {})
    }
    refresh()
    md.addEventListener?.('devicechange', refresh)
    return () => {
      alive = false
      md.removeEventListener?.('devicechange', refresh)
    }
  }, [kind])

  return devices
}
