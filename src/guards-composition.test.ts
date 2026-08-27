/**
 * The generated guards, run through a real ESLint.
 *
 * Split from guards.test.ts on a real seam: that file asserts what `planGuards` writes,
 * this one asserts what a checker does when the written config is loaded and run. Two
 * reasons to change — the generator's output shape, and the checker's behaviour.
 */
import { describe, expect, test } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { planGuards } from './guards.js'
import { defaultConfig, type Architecture } from './config.js'

function makeTemp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

const SAMPLE_ARCH: Architecture = {
  layers: [
    { name: 'ui', paths: ['src/ui/', 'apps/'], pure: false },
    { name: 'app', paths: ['src/app/'], pure: false },
    { name: 'domain', paths: ['src/domain/'], pure: true },
    { name: 'infra', paths: ['src/infra/'], pure: false },
  ],
  moduleRoots: ['src/modules/', 'packages/'],
  entryPoints: ['index.ts', 'index.tsx', 'index.js'],
  maxFileLines: 400,
  maxFunctionLines: 50,
  impureImports: ['node:fs', 'node:child_process', 'node:http', 'node:https', 'node:crypto'],
}

describe('one violation, one error (T13b)', () => {
  test('the generated pure-layer block has no `paths` key', () => {
    const config = { ...defaultConfig('/root'), architecture: SAMPLE_ARCH }
    const guards = planGuards(config).files.find((f) => f.path === 'anchoring.guards.mjs')

    expect(guards).toBeDefined()
    expect(guards?.body).toContain("'no-restricted-imports'")
    expect(guards?.body).toContain('patterns: [')
    expect(guards?.body).not.toContain('paths: [')
  })

  test('ESLint over a fixture importing a restricted module yields exactly one error', async () => {
    const root = makeTemp('kb-guards-one-error-')
    const arch: Architecture = {
      layers: [{ name: 'domain', paths: ['src/domain/'], pure: true }],
      moduleRoots: [],
      entryPoints: ['index.ts'],
      maxFileLines: 400,
      maxFunctionLines: 50,
      impureImports: ['node:fs'],
    }
    const config = { ...defaultConfig(root), architecture: arch }
    const guards = planGuards(config).files.find((f) => f.path === 'anchoring.guards.mjs')
    if (!guards) throw new Error('no guards file generated')

    const guardsPath = join(root, 'anchoring.guards.mjs')
    writeFileSync(guardsPath, guards.body)

    const { ESLint } = await import('eslint')
    const loaded = (await import(pathToFileURL(guardsPath).href)) as { default: unknown[] }
    // `cwd` and a repo-relative filePath together: the generated globs are repo-relative,
    // so ESLint's base path has to be the fixture repo or every file is "outside base path".
    const eslint = new ESLint({
      cwd: root,
      overrideConfigFile: true,
      overrideConfig: loaded.default as never,
    })

    const results = await eslint.lintText("import { readFileSync } from 'node:fs'\nexport const x = readFileSync\n", {
      filePath: 'src/domain/thing.js',
    })
    const restricted = results[0]?.messages.filter((m) => m.ruleId === 'no-restricted-imports') ?? []
    expect(restricted.length).toBe(1)

    rmSync(root, { recursive: true, force: true })
  })
})

describe('the file-size ceiling covers test files (T13c)', () => {
  test('the generated config carries a test-file max-lines block at the same ceiling', () => {
    const config = { ...defaultConfig('/root'), architecture: { ...SAMPLE_ARCH, maxFileLines: 321 } }
    const guards = planGuards(config).files.find((f) => f.path === 'anchoring.guards.mjs')
    if (!guards) throw new Error('no guards file generated')

    const testBlock = guards.body.slice(guards.body.indexOf("files: ['**/*.test.*', '**/*.spec.*']"))
    expect(testBlock).toContain("'max-lines'")
    expect(testBlock).toContain('max: 321')
    // The function limit stays off for tests: a long `describe` body is not a defect.
    expect(testBlock).toContain("'max-lines-per-function': 'off'")
  })
})
