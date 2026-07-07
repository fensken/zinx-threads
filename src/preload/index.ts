import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer. Keep this narrow + typed (see index.d.ts) — it is the
// ONLY surface the web/desktop `platform` layer (renderer/src/lib/platform.ts)
// bridges to. Every method is validated + handled in the main process.
const api = {
  /** Open an external URL in the OS default browser (validated in main). */
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
