import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    // Excalidraw reads `process.env.IS_PREACT` at module scope; without this define it
    // throws `process is not defined` in the browser. Its own docs prescribe exactly
    // this for Vite.
    define: { 'process.env.IS_PREACT': JSON.stringify('false') },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@convex': resolve('convex'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [
      // File-based routing: generates src/renderer/src/routeTree.gen.ts.
      // Paths are relative to electron-vite's renderer root (src/renderer),
      // not the project root. Must come before the React plugin.
      tanstackRouter({
        target: 'react',
        routesDirectory: 'src/routes',
        generatedRouteTree: 'src/routeTree.gen.ts',
        autoCodeSplitting: true
      }),
      react(),
      tailwindcss()
    ]
  }
})
