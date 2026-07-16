import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

// Standalone WEB build of the renderer — the exact same React app that runs
// inside the Electron window, served in a browser instead. `electron.vite.config.ts`
// builds the desktop target (main + preload + renderer); this builds the web
// target from the identical `src/renderer` sources.
//
// The single codebase stays portable because: data goes straight to Convex (works
// everywhere), native calls go through `src/renderer/src/lib/platform.ts` (web
// fallbacks), and the router picks browser vs hash history per target.
export default defineConfig({
  // Excalidraw reads `process.env.IS_PREACT` at module scope — see the note in
  // electron.vite.config.ts.
  define: { 'process.env.IS_PREACT': JSON.stringify('false') },
  root: resolve(__dirname, 'src/renderer'),
  // `.env.local` lives at the project root, but `envDir` defaults to `root`
  // (src/renderer) — point it back so the web build sees VITE_CONVEX_URL / WorkOS.
  envDir: __dirname,
  // Absolute base so assets resolve from the host root regardless of the current
  // deep-link path (browser history). Change if deploying under a sub-path.
  base: '/',
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@convex': resolve(__dirname, 'convex')
    }
  },
  plugins: [
    // Same file-based routing as the desktop build. Paths are relative to the
    // renderer root, so this regenerates the identical routeTree.gen.ts.
    tanstackRouter({
      target: 'react',
      routesDirectory: 'src/routes',
      generatedRouteTree: 'src/routeTree.gen.ts',
      autoCodeSplitting: true
    }),
    react(),
    tailwindcss()
  ],
  build: {
    outDir: resolve(__dirname, 'out/web'),
    emptyOutDir: true
  }
})
