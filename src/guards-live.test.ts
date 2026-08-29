/**
 * The generated guards, as they actually take effect.
 *
 * `guards.test.ts` checks what the generator *emits*. This file checks what ESLint *applies*,
 * which is not the same thing and was not the same thing: hand-written blocks in
 * `eslint.config.js` sat after `...anchoringGuards` and replaced two rules wholesale, because
 * flat config does not merge rules - the later object wins, silently. The pure layer's ban on
 * `node:http`, `node:https` and `node:crypto` was switched off for months and every gate
 * reported success. See .anchor/incident/INC-0004.md.
 *
 * A generated rule that nothing verifies is a claim, not a check.
 */
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { ESLint } from 'eslint'
import { parseConfig } from './config.js'

// Through `parseConfig`, not straight from the JSON: the fields that matter here mostly go
// undeclared and come from defaults, and a test reading raw JSON would quietly check `{}`.
const parsed = parseConfig(process.cwd(), JSON.parse(readFileSync('anchoring.config.json', 'utf8')))
if (!parsed.ok) throw new Error(`anchoring.config.json is invalid: ${parsed.problems.join('; ')}`)
const arch = parsed.config.architecture
if (!arch) throw new Error('anchoring.config.json declares no architecture')

/** A pure-domain module, and so subject to every generated rule at once. */
const PURE_FILE = 'src/brief.ts'

describe('the generated rules survive composition', { timeout: 30_000 }, () => {
  const eslint = new ESLint()

  test('every declared impure import is actually banned in the pure layer', async () => {
    const applied = (await eslint.calculateConfigForFile(PURE_FILE)) as {
      rules: Record<string, unknown>
    }
    const patterns = JSON.stringify(applied.rules['no-restricted-imports'])

    for (const mod of arch.impureImports) {
      expect(patterns, `${mod} is declared impure but no rule bans it`).toContain(mod)
    }
  })

  test('the ban on constructing a Date reaches the pure layer', async () => {
    const applied = (await eslint.calculateConfigForFile(PURE_FILE)) as {
      rules: Record<string, unknown>
    }
    expect(JSON.stringify(applied.rules['no-restricted-syntax'])).toContain('callee.name')
  })

  test('a project selector is not lost when the pure-layer block redeclares the rule', async () => {
    // Both blocks name `no-restricted-syntax`, and the later one wins outright. The pure
    // block therefore has to repeat the project selectors; this is the test that notices
    // when it stops.
    const applied = (await eslint.calculateConfigForFile(PURE_FILE)) as {
      rules: Record<string, unknown>
    }
    expect(JSON.stringify(applied.rules['no-restricted-syntax'])).toContain('INV-CONFIG-THREADED')
  })

  test('an unregistered file is still governed', async () => {
    // Layer paths enumerate files; a module added before anyone registers it must not fall
    // through every block and arrive unguarded.
    const results = await eslint.lintText("import { readFileSync } from 'node:fs'\nexport const x = readFileSync\n", {
      filePath: 'src/not-registered-anywhere.ts',
    })
    const found = results[0]?.messages.find((m) => m.ruleId === 'no-restricted-imports')

    expect(found, 'a new src/ file was subject to no import rule at all').toBeDefined()
  })

  test('a declared I/O adapter keeps its exemption', async () => {
    const exempt = arch.ioExemptions[0] ?? 'src/loader.ts'
    const results = await eslint.lintText("import { readFileSync } from 'node:fs'\nexport const x = readFileSync\n", {
      filePath: exempt,
    })

    expect(results[0]?.messages.find((m) => m.ruleId === 'no-restricted-imports')).toBeUndefined()
  })
})

describe('the size ratchet is pinned, not merely present', { timeout: 60_000 }, () => {
  test('the baseline is not empty and every entry names a real file', () => {
    expect(Object.keys(arch.maxFunctionLinesBaseline).length).toBeGreaterThan(0)
    for (const file of Object.keys(arch.maxFunctionLinesBaseline)) {
      expect(() => readFileSync(file, 'utf8')).not.toThrow()
    }
  })

  test('every exemption is above the real limit, so none is decorative', () => {
    for (const [file, max] of Object.entries(arch.maxFunctionLinesBaseline)) {
      expect(max, `${file} is exempt at or below the limit; delete the entry`).toBeGreaterThan(
        arch.maxFunctionLines,
      )
    }
  })

  /**
   * The half that makes it a ratchet rather than an amnesty.
   *
   * Each entry must be the file's longest function exactly. One line lower must fail. So an
   * entry cannot be inflated to wave a regression through, and once the function is finally
   * split the entry has to come down with it or this test says so.
   */
  test('each baseline equals its file\'s longest function, to the line', async () => {
    for (const [file, max] of Object.entries(arch.maxFunctionLinesBaseline)) {
      const tighter = new ESLint({
        overrideConfig: {
          rules: {
            'max-lines-per-function': [
              'error',
              { max: max - 1, skipBlankLines: true, skipComments: true },
            ],
          },
        },
      })
      const results = await tighter.lintFiles([file])
      const over = results[0]?.messages.filter((m) => m.ruleId === 'max-lines-per-function') ?? []

      expect(over.length, `${file}: baseline ${max} is slack; lower it to the real maximum`)
        .toBeGreaterThan(0)
    }
  })
})
