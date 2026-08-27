import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      exclude: ['**/node_modules/**', '**/dist/**', '**/*.test.ts', 'vitest.config.ts', 'eslint.config.js'],
    },
  },
})
