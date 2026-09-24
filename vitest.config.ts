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
          include: ['src/renderer/**/*.test.ts'],
          exclude: ['src/renderer/**/*.dom.test.tsx']
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
          name: 'editor',
          // ProseMirror IS a DOM library — its keymaps, input rules and selection logic
          // only exist against a real document. The doc editor's keyboard behaviour (Enter
          // splits a block, an open `/` menu takes Enter first) can't be asserted any other
          // way, and it is exactly the kind of thing that breaks silently.
          environment: 'jsdom',
          setupFiles: [resolve(__dirname, 'src/renderer/src/test/dom-setup.ts')],
          include: ['src/renderer/**/*.dom.test.tsx']
        }
      }
    ]
  }
})
