import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'

describe('invariants enforcement (eslint)', { timeout: 20_000 }, () => {
  const eslint = new ESLint()

  describe('INV-CONFIG-THREADED (no-restricted-syntax)', () => {
    it('rejects top-level let config in src/**', async () => {
      const results = await eslint.lintText('let config: any;\n', { filePath: 'src/dummy.ts' })
      const error = results[0]?.messages.find((m) => m.ruleId === 'no-restricted-syntax')
      expect(error).toBeDefined()
      expect(error?.message).toContain('INV-CONFIG-THREADED')
    })

    it('rejects top-level export let config in src/**', async () => {
      const results = await eslint.lintText('export let config: any;\n', { filePath: 'src/dummy.ts' })
      const error = results[0]?.messages.find((m) => m.ruleId === 'no-restricted-syntax')
      expect(error).toBeDefined()
      expect(error?.message).toContain('INV-CONFIG-THREADED')
    })

    it('rejects top-level var config in src/**', async () => {
      const results = await eslint.lintText('var config: any;\n', { filePath: 'src/dummy.ts' })
      const error = results[0]?.messages.find((m) => m.ruleId === 'no-restricted-syntax')
      expect(error).toBeDefined()
      expect(error?.message).toContain('INV-CONFIG-THREADED')
    })

    it('allows local config variables inside functions', async () => {
      const code = 'export function doSomething() {\n  const config = { ok: true }\n  return config\n}\n'
      const results = await eslint.lintText(code, { filePath: 'src/dummy.ts' })
      const error = results[0]?.messages.find((m) => m.ruleId === 'no-restricted-syntax')
      expect(error).toBeUndefined()
    })
  })

  describe('INV-INJECTED-IO (no-restricted-imports)', () => {
    it('bans node:fs in core logic modules', async () => {
      const results = await eslint.lintText("import { readFileSync } from 'node:fs';\nexport const x = readFileSync;\n", {
        filePath: 'src/verify.ts',
      })
      const error = results[0]?.messages.find((m) => m.ruleId === 'no-restricted-imports')
      expect(error).toBeDefined()
      expect(error?.message).toContain('INV-INJECTED-IO')
    })

    it('bans node:child_process in core logic modules', async () => {
      const results = await eslint.lintText("import { spawnSync } from 'node:child_process';\nexport const x = spawnSync;\n", {
        filePath: 'src/why.ts',
      })
      const error = results[0]?.messages.find((m) => m.ruleId === 'no-restricted-imports')
      expect(error).toBeDefined()
      expect(error?.message).toContain('INV-INJECTED-IO')
    })

    it('permits node:fs in allowed I/O boundary modules', async () => {
      const results = await eslint.lintText("import { readFileSync } from 'node:fs';\nexport const x = readFileSync;\n", {
        filePath: 'src/store.ts',
      })
      const error = results[0]?.messages.find((m) => m.ruleId === 'no-restricted-imports')
      expect(error).toBeUndefined()
    })

    it('permits node:child_process in git.ts', async () => {
      const results = await eslint.lintText("import { spawnSync } from 'node:child_process';\nexport const x = spawnSync;\n", {
        filePath: 'src/git.ts',
      })
      const error = results[0]?.messages.find((m) => m.ruleId === 'no-restricted-imports')
      expect(error).toBeUndefined()
    })
  })

  describe('public index exports', () => {
    it('exports all expected public APIs', async () => {
      const index = await import('./index.js')
      expect(index.verify).toBeTypeOf('function')
      expect(index.why).toBeTypeOf('function')
      expect(index.ctx).toBeTypeOf('function')
      expect(index.done).toBeTypeOf('function')
      expect(index.run).toBeTypeOf('function')
      expect(index.loadConfig).toBeTypeOf('function')
      expect(index.defaultConfig).toBeTypeOf('function')
      expect(index.findRepoRoot).toBeTypeOf('function')
      expect(index.planInit).toBeTypeOf('function')
      expect(index.applyInit).toBeTypeOf('function')
    })
  })
})
