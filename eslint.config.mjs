import { defineConfig } from 'eslint/config'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginReact from 'eslint-plugin-react'
import eslintPluginReactHooks from 'eslint-plugin-react-hooks'
import eslintPluginReactRefresh from 'eslint-plugin-react-refresh'

export default defineConfig(
  {
    // `convex/` has its own toolchain (`npx convex dev` typechecks it against
    // generated types + the not-yet-installed component packages) — keep it out
    // of the app's lint pass.
    ignores: [
      '**/node_modules',
      '**/dist',
      '**/out',
      '**/routeTree.gen.ts',
      'convex/**',
      'scripts/**'
    ]
  },
  tseslint.configs.recommended,
  eslintPluginReact.configs.flat.recommended,
  eslintPluginReact.configs.flat['jsx-runtime'],
  {
    settings: {
      react: {
        version: 'detect'
      }
    }
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': eslintPluginReactHooks,
      'react-refresh': eslintPluginReactRefresh
    },
    rules: {
      ...eslintPluginReactHooks.configs.recommended.rules,
      ...eslintPluginReactRefresh.configs.vite.rules
    }
  },
  {
    // shadcn/ui components are generated/vendored — don't hold them to the
    // project's return-type, fast-refresh, or react-hooks strictness rules.
    files: ['src/renderer/src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/refs': 'off',
      'react/prop-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off'
    }
  },
  {
    // Vitest test files — relax the return-type strictness on test/`describe`
    // callbacks (they're always void) so specs read like specs.
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off'
    }
  },
  eslintConfigPrettier
)
