import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@convex': resolve('convex')
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
