import { describe, it, expect } from 'vitest'
// ESLint is imported here, and only here, on purpose: an invariant that is only
// *generated* is a claim, and this file is where the claim gets run. `the-anchoring`
// never runs a checker — a test that does is what makes "the generated rule fires"
// machine-checkable. See docs/PLAN-LAYER3.md §3.
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
        filePath: 'src/loader.ts',
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

  describe('INV-PURE-PLAN (purity is the redaction mechanism)', () => {
    // Not a lint rule but a source grep, and deliberately so: the claim is about the whole
    // file, not about one import statement, and it is the guarantee that a report cannot
    // carry a source line, a diff, or a secret. A function that cannot read a file cannot
    // leak one. See src/upstream.ts and docs/THE_ANCHORING.md, "The upstream loop".
    const BANNED = ['node:fs', 'node:child_process', 'node:crypto', 'new Date']

    /** Comment lines are dropped so a doc comment *naming* the ban does not trip it. */
    const stripComments = (source: string): string =>
      source
        .split(/\r?\n/)
        .filter((line) => {
          const trimmed = line.trimStart()
          return (
            !trimmed.startsWith('*') && !trimmed.startsWith('//') && !trimmed.startsWith('/*')
          )
        })
        .join('\n')

    for (const file of ['src/upstream.ts', 'src/guards.ts', 'src/pack.ts', 'src/ask.ts', 'src/promote.ts']) {
      it(`${file} performs no I/O and reads no clock`, async () => {
        const { readFileSync } = await import('node:fs')
        const source = readFileSync(file, 'utf8')
        const code = stripComments(source)

        for (const banned of BANNED) {
          expect(code.includes(banned), `${file} mentions ${banned} outside a comment`).toBe(false)
        }
      })
    }
  })

  describe('public index exports', () => {
    it('exports all expected public APIs', async () => {
      const index = await import('./index.js')
      expect(index.ask).toBeTypeOf('function')
      expect(index.renderAsk).toBeTypeOf('function')
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
      expect(index.planPromote).toBeTypeOf('function')
    })
  })
})
