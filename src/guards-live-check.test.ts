/**
 * Tests for the live-rule check itself.
 *
 * The first version of this check asked only whether the rule *name* was present at a
 * non-off severity. A host block declaring `no-restricted-imports` for lodash replaced the
 * generated one, the name was still there at severity error, the command reported "in force"
 * — and `node:https` was importable from the pure layer with no complaint. The case below
 * named "an override that keeps the rule name" is that exact scenario, and it is the reason
 * this file exists.
 */
import { describe, expect, test } from 'vitest'
import { liveExpectations, checkLiveRules } from './guards-live.js'
import { DEFAULT_ENTRY_POINTS, DEFAULT_IMPURE_IMPORTS, DEFAULT_IO_MESSAGE } from './config.js'
import { parsePrintConfig } from './eslint-probe.js'
import type { Architecture } from './config.js'

const ARCH: Architecture = {
  layers: [
    { name: 'app', paths: ['src/render.ts'], pure: false },
    { name: 'domain', paths: ['src/brief.ts'], pure: true },
  ],
  moduleRoots: [],
  entryPoints: DEFAULT_ENTRY_POINTS,
  maxFileLines: 400,
  maxFunctionLines: 50,
  maxFunctionLinesBaseline: {},
  impureImports: DEFAULT_IMPURE_IMPORTS,
  ioExemptions: ['src/loader.ts'],
  restrictedSyntax: [{ selector: 'VariableDeclarator[id.name="config"]', message: 'no mutable config' }],
  ioMessage: DEFAULT_IO_MESSAGE,
}

/** What a correctly composed ESLint config looks like for the pure file. */
const HEALTHY = {
  'no-restricted-imports': [
    'error',
    { patterns: DEFAULT_IMPURE_IMPORTS.map((m) => ({ group: [m, `${m}/*`], message: 'no' })) },
  ],
  'no-restricted-syntax': [
    'error',
    { selector: 'VariableDeclarator[id.name="config"]', message: 'no mutable config' },
    { selector: 'NewExpression[callee.name="Date"]', message: 'no clock' },
  ],
  'no-restricted-globals': ['error', { name: 'fetch', message: 'no' }],
  'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'no' }],
}

describe('liveExpectations', () => {
  test('expects every declared impure import, plus the pure-layer rules', () => {
    const rules = liveExpectations(ARCH, 'src/brief.ts').map((e) => e.needle)

    for (const mod of DEFAULT_IMPURE_IMPORTS) expect(rules).toContain(mod)
    expect(rules).toContain('NewExpression[callee.name=')
    expect(rules).toContain('fetch')
  })

  test('expects no import ban of a declared I/O adapter', () => {
    // The adapters exist to do the thing the ban forbids. Demanding the ban applies to them
    // would make the check fail on a correct configuration.
    const rules = liveExpectations(ARCH, 'src/loader.ts').map((e) => e.needle)

    expect(rules).not.toContain('node:fs')
  })

  test('expects no pure-layer rule for a file outside the pure layer', () => {
    const rules = liveExpectations(ARCH, 'src/render.ts').map((e) => e.needle)

    expect(rules).toContain('node:fs')
    expect(rules).not.toContain('fetch')
  })
})

describe('checkLiveRules', () => {
  test('reports everything satisfied on a healthy config', () => {
    const report = checkLiveRules('src/brief.ts', liveExpectations(ARCH, 'src/brief.ts'), HEALTHY)

    expect(report.missing).toEqual([])
    expect(report.satisfied.length).toBeGreaterThan(0)
  })

  /** The case that must speak, and the case the first implementation got wrong. */
  test('catches an override that keeps the rule name but drops its content', () => {
    const overridden = {
      ...HEALTHY,
      'no-restricted-imports': ['error', { paths: [{ name: 'lodash' }] }],
    }

    const report = checkLiveRules('src/brief.ts', liveExpectations(ARCH, 'src/brief.ts'), overridden)

    expect(report.missing.map((e) => e.needle)).toEqual(DEFAULT_IMPURE_IMPORTS)
    expect(report.missing[0]?.why).toContain('declared impure')
  })

  test('treats a rule switched off as missing', () => {
    const off = { ...HEALTHY, 'no-restricted-globals': 'off' }
    const report = checkLiveRules('src/brief.ts', liveExpectations(ARCH, 'src/brief.ts'), off)

    expect(report.missing.map((e) => e.needle)).toContain('fetch')
  })

  test('treats an absent rule as missing', () => {
    const report = checkLiveRules('src/brief.ts', liveExpectations(ARCH, 'src/brief.ts'), {})

    expect(report.satisfied).toEqual([])
    expect(report.missing.length).toBeGreaterThan(0)
  })

  test('matches a selector containing double quotes', () => {
    // The needle is compared against string values in the structure, not against
    // JSON.stringify output, where `"` is escaped and the naive comparison missed.
    const report = checkLiveRules('src/brief.ts', liveExpectations(ARCH, 'src/brief.ts'), HEALTHY)

    expect(report.satisfied.map((e) => e.needle)).toContain('VariableDeclarator[id.name="config"]')
  })
})

describe('parsePrintConfig', () => {
  test('extracts the rules table', () => {
    expect(parsePrintConfig('{"rules":{"no-console":["error"]}}')).toEqual({
      'no-console': ['error'],
    })
  })

  test('returns undefined when it cannot tell, rather than an empty table', () => {
    // "Could not tell" and "no rules are missing" are opposite facts. A verifier that reads
    // its own failure as a pass is worse than no verifier.
    expect(parsePrintConfig('not json')).toBeUndefined()
    expect(parsePrintConfig('{"no-rules-key":1}')).toBeUndefined()
    expect(parsePrintConfig('null')).toBeUndefined()
  })
})
