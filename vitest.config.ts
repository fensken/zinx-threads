import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// Two test projects with different runtimes:
//   • convex   — backend functions via convex-test, in the edge-runtime VM
//     (`@edge-runtime/vm`), which is the environment Convex functions run in.
//   • renderer — pure renderer logic (message grouping, preview, mentions) in
//     plain node; these modules touch no DOM, so no jsdom is needed.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'convex',
          environment: 'edge-runtime',
          include: ['convex/**/*.test.ts'],
          server: { deps: { inline: ['convex-test'] } }
        }
      },
      {
        resolve: {
          alias: {
            '@renderer': resolve(__dirname, 'src/renderer/src'),
            '@convex': resolve(__dirname, 'convex')
          }
        },
        test: {
          name: 'renderer',
          environment: 'node',
          include: ['src/renderer/**/*.test.ts']
        }
      }
    ]
  }
})
