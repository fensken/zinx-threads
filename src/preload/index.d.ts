import { ElectronAPI } from '@electron-toolkit/preload'

/** The narrow, typed bridge exposed by the preload (see preload/index.ts).
 *  In a browser build these globals are absent — the renderer must reach them
 *  only through `renderer/src/lib/platform.ts`, which feature-detects + falls
 *  back so the same code runs as the Electron app and as a plain web app. */
export interface ZinxApi {
  openExternal: (url: string) => Promise<void>
}

declare global {
  interface Window {
    electron?: ElectronAPI
    api?: ZinxApi
  }
}
