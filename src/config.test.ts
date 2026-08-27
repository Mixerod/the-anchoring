import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defaultConfig,
  loadConfig,
  parseConfig,
  DEFAULT_ENTRY_POINTS,
  DEFAULT_IMPURE_IMPORTS,
  DEFAULT_MAX_FILE_LINES,
  DEFAULT_MAX_FUNCTION_LINES,
} from './config.js'
import { kindOf } from './model.js'
import { loadStore } from './store.js'
import { createResolver } from './anchors.js'
import { run } from './cli.js'

function makeTemp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('defaultConfig', () => {
  test('returns standard defaults with the supplied root', () => {
    const config = defaultConfig('/test/root')

    expect(config.root).toBe('/test/root')
    expect(config.kbRoot).toBe('.anchor')
    expect(config.kinds.ADR.dir).toBe('docs/adr')
    expect(config.kinds.INV.dir).toBe('.anchor/invariant')
    expect(config.kinds.FLOW.dir).toBe('.anchor/flow')
    expect(config.kinds.WORK.dir).toBe('.anchor/work')
    expect(config.kinds.INC.dir).toBe('.anchor/incident')
    expect(config.kinds.HAZ.dir).toBe('.anchor/hazard')
    expect(config.governedPaths).toEqual(['src/', 'packages/', 'apps/', 'lib/', 'scripts/'])
    expect(config.hazard).toEqual({ openDays: 30, ceiling: 24 })
    expect(config.symbolIndex).toBe('codegraph')
    expect(config.sessionFile).toBe('.anchor/session/current')
    expect('architecture' in config).toBe(false)
  })
})

describe('parseConfig & loadConfig basics', () => {
  test('{} yields defaults identical to defaultConfig', () => {
    const root = '/my/root'
    const result = parseConfig(root, {})

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config).toEqual(defaultConfig(root))
    }
  })

  test('absent file in loadConfig yields defaults', () => {
    const root = makeTemp('kb-config-absent-')
    const result = loadConfig(root)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config).toEqual(defaultConfig(root))
    }
  })

  test('kbRoot override moves all five non-ADR dirs and session file', () => {
    const root = '/root'
    const result = parseConfig(root, { kbRoot: 'custom/kb' })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.kbRoot).toBe('custom/kb')
      expect(result.config.kinds.ADR.dir).toBe('docs/adr')
      expect(result.config.kinds.INV.dir).toBe('custom/kb/invariant')
      expect(result.config.kinds.FLOW.dir).toBe('custom/kb/flow')
      expect(result.config.kinds.WORK.dir).toBe('custom/kb/work')
      expect(result.config.kinds.INC.dir).toBe('custom/kb/incident')
      expect(result.config.kinds.HAZ.dir).toBe('custom/kb/hazard')
      expect(result.config.sessionFile).toBe('custom/kb/session/current')
    }
  })

  test('a per-kind dir override wins over the kbRoot-derived default', () => {
    const result = parseConfig('/root', {
      kbRoot: '.kb',
      kinds: {
        INV: { dir: 'custom/invariants' },
        ADR: { dir: 'architecture/decisions' },
      },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.config.kinds.INV.dir).toBe('custom/invariants')
      expect(result.config.kinds.ADR.dir).toBe('architecture/decisions')
      expect(result.config.kinds.WORK.dir).toBe('.kb/work')
    }
  })

  test('idPattern override is honoured by kindOf', () => {
    const result = parseConfig('/root', {
      kinds: {
        WORK: { idPattern: '^TASK-[0-9]+$' },
      },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(kindOf(result.config, 'TASK-123')).toBe('WORK')
      expect(kindOf(result.config, 'W-123')).toBeUndefined()
    }
  })

  test('statuses override is honoured by the loader', () => {
    const root = makeTemp('kb-config-statuses-')
    const configResult = parseConfig(root, {
      kinds: {
        WORK: { statuses: ['planned', 'completed'] },
      },
    })
    expect(configResult.ok).toBe(true)
    if (!configResult.ok) return

    mkdirSync(join(root, '.anchor', 'work'), { recursive: true })
    writeFileSync(
      join(root, '.anchor', 'work', 'W-1.md'),
      '---\nid: W-1\ntitle: Work 1\nstatus: completed\n---\n',
    )
    writeFileSync(
      join(root, '.anchor', 'work', 'W-2.md'),
      '---\nid: W-2\ntitle: Work 2\nstatus: done\n---\n',
    )

    const store = loadStore(configResult.config)
    expect(store.byId.has('W-1')).toBe(true)
    expect(store.byId.has('W-2')).toBe(false)
    expect(store.problems.some((p) => p.message.includes('status `done` is not one of'))).toBe(true)
  })
})

describe('parseConfig validation rules', () => {
  test('rejects non-object top levels', () => {
    expect(parseConfig('/root', null)).toEqual({
      ok: false,
      problems: expect.arrayContaining(['top level must be an object']),
    })
    expect(parseConfig('/root', [])).toEqual({
      ok: false,
      problems: expect.arrayContaining(['top level must be an object']),
    })
    expect(parseConfig('/root', 'not an object')).toEqual({
      ok: false,
      problems: expect.arrayContaining(['top level must be an object']),
    })
  })

  test('rejects unknown top-level keys', () => {
    const result = parseConfig('/root', { typoKey: 123, anotherTypo: true })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problems.some((p) => p.includes('unknown top-level key `typoKey`'))).toBe(true)
      expect(result.problems.some((p) => p.includes('accepted keys are:'))).toBe(true)
    }
  })

  test('rejects invalid kbRoot', () => {
    expect(parseConfig('/root', { kbRoot: '' })).toEqual({
      ok: false,
      problems: expect.arrayContaining([expect.stringContaining('`kbRoot` must be a non-empty string')]),
    })
    expect(parseConfig('/root', { kbRoot: '/absolute/path' })).toEqual({
      ok: false,
      problems: expect.arrayContaining([expect.stringContaining('must be a repo-relative POSIX path')]),
    })
    expect(parseConfig('/root', { kbRoot: 'some/../path' })).toEqual({
      ok: false,
      problems: expect.arrayContaining([expect.stringContaining('must be a repo-relative POSIX path')]),
    })
    expect(parseConfig('/root', { kbRoot: 'some\\path' })).toEqual({
      ok: false,
      problems: expect.arrayContaining([expect.stringContaining('must be a repo-relative POSIX path')]),
    })
  })

  test('rejects unknown kind keys and non-object kind specs', () => {
    const result = parseConfig('/root', {
      kinds: {
        UNKNOWN_KIND: { dir: 'foo' },
        ADR: 'not-an-object',
      },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problems.some((p) => p.includes('unknown key `UNKNOWN_KIND` under `kinds`'))).toBe(true)
      expect(result.problems.some((p) => p.includes('kinds.ADR must be an object'))).toBe(true)
    }
  })

  test('rejects unknown keys under kind specs', () => {
    const result = parseConfig('/root', {
      kinds: {
        ADR: { dir: 'docs/adr', bogusKey: 42 },
      },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problems.some((p) => p.includes('unknown key `bogusKey` under kinds.ADR'))).toBe(true)
    }
  })

  test('rejects invalid kind dir', () => {
    expect(parseConfig('/root', { kinds: { ADR: { dir: '/abs/path' } } })).toEqual({
      ok: false,
      problems: expect.arrayContaining([expect.stringContaining('must be a repo-relative POSIX path')]),
    })
    expect(parseConfig('/root', { kinds: { ADR: { dir: '../parent' } } })).toEqual({
      ok: false,
      problems: expect.arrayContaining([expect.stringContaining('must be a repo-relative POSIX path')]),
    })
    expect(parseConfig('/root', { kinds: { ADR: { dir: 'win\\path' } } })).toEqual({
      ok: false,
      problems: expect.arrayContaining([expect.stringContaining('must be a repo-relative POSIX path')]),
    })
  })

  test('rejects invalid idPattern', () => {
    expect(parseConfig('/root', { kinds: { WORK: { idPattern: 'W-\\d+' } } })).toEqual({
      ok: false,
      problems: expect.arrayContaining([
        expect.stringContaining('must be a string starting with `^` and ending with `$`'),
      ]),
    })
    expect(parseConfig('/root', { kinds: { WORK: { idPattern: '^[' } } })).toEqual({
      ok: false,
      problems: expect.arrayContaining([
        expect.stringContaining('must be a string starting with `^` and ending with `$`'),
      ]),
    })
    expect(parseConfig('/root', { kinds: { WORK: { idPattern: '^[unclosed$' } } })).toEqual({
      ok: false,
      problems: expect.arrayContaining([
        expect.stringContaining('not a valid regular expression'),
      ]),
    })
  })

  test('rejects invalid statuses', () => {
    expect(parseConfig('/root', { kinds: { WORK: { statuses: [] } } })).toEqual({
      ok: false,
      problems: expect.arrayContaining([
        expect.stringContaining('must be a non-empty array of non-empty strings'),
      ]),
    })
    expect(parseConfig('/root', { kinds: { WORK: { statuses: [''] } } })).toEqual({
      ok: false,
      problems: expect.arrayContaining([
        expect.stringContaining('must be a non-empty array of non-empty strings'),
      ]),
    })
    expect(parseConfig('/root', { kinds: { WORK: { statuses: [123] } } })).toEqual({
      ok: false,
      problems: expect.arrayContaining([
        expect.stringContaining('must be a non-empty array of non-empty strings'),
      ]),
    })
  })

  test('rejects and normalises governedPaths', () => {
    expect(parseConfig('/root', { governedPaths: [] })).toEqual({
      ok: false,
      problems: expect.arrayContaining([
        expect.stringContaining('`governedPaths` must be an array of non-empty strings'),
      ]),
    })
    expect(parseConfig('/root', { governedPaths: [''] })).toEqual({
      ok: false,
      problems: expect.arrayContaining([
        expect.stringContaining('`governedPaths` must be an array of non-empty strings'),
      ]),
    })

    const normalised = parseConfig('/root', { governedPaths: ['src', 'packages/'] })
    expect(normalised.ok).toBe(true)
    if (normalised.ok) {
      expect(normalised.config.governedPaths).toEqual(['src/', 'packages/'])
    }
  })

  test('rejects invalid hazard config', () => {
    expect(parseConfig('/root', { hazard: 'not-an-object' })).toEqual({
      ok: false,
      problems: expect.arrayContaining([expect.stringContaining('`hazard` must be an object')]),
    })
    expect(parseConfig('/root', { hazard: { openDays: -5 } })).toEqual({
      ok: false,
      problems: expect.arrayContaining([expect.stringContaining('hazard.openDays must be a positive integer')]),
    })
    expect(parseConfig('/root', { hazard: { ceiling: 0 } })).toEqual({
      ok: false,
      problems: expect.arrayContaining([expect.stringContaining('hazard.ceiling must be a positive integer')]),
    })
    expect(parseConfig('/root', { hazard: { ceiling: 3.14 } })).toEqual({
      ok: false,
      problems: expect.arrayContaining([expect.stringContaining('hazard.ceiling must be a positive integer')]),
    })
  })

  test('rejects invalid symbolIndex', () => {
    expect(parseConfig('/root', { symbolIndex: 'invalid' })).toEqual({
      ok: false,
      problems: expect.arrayContaining([expect.stringContaining('`symbolIndex` must be "codegraph" or "none"')]),
    })
  })

  test('rejects two kinds sharing the same dir', () => {
    const result = parseConfig('/root', {
      kinds: {
        INV: { dir: 'shared/dir' },
        FLOW: { dir: 'shared/dir' },
      },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problems.some((p) => p.includes('resolve to the same dir `shared/dir`'))).toBe(true)
    }
  })
})

describe('loadConfig file errors and CLI integration', () => {
  test('reports invalid JSON file error', () => {
    const root = makeTemp('kb-config-badjson-')
    writeFileSync(join(root, 'anchoring.config.json'), '{ bad json')

    const result = loadConfig(root)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.problems[0]).toMatch(/anchoring\.config\.json: invalid JSON:/)
    }
  })

  test('a bad config makes run(["verify"], ...) exit 2 and print config error:', () => {
    const root = makeTemp('kb-bad-config-cli-')
    writeFileSync(join(root, 'anchoring.config.json'), '{ "symbolIndex": "invalid" }')

    const out: string[] = []
    const err: string[] = []
    const code = run(['verify', '--no-colour'], (t) => out.push(t), (t) => err.push(t), root)

    expect(code).toBe(2)
    expect(err.join('\n')).toContain('config error:')
    expect(err.join('\n')).toContain('`symbolIndex` must be "codegraph" or "none"')
  })
})

describe('symbolIndex: "none"', () => {
  test('reports sym: anchors as unverifiable and never calls the probe', () => {
    const root = makeTemp('kb-no-symbol-')
    const config = {
      ...defaultConfig(root),
      symbolIndex: 'none' as const,
    }

    const explodingProbe = () => {
      throw new Error('probe must not be called when symbolIndex is "none"')
    }

    const resolver = createResolver(config, explodingProbe)
    expect(resolver.indexed).toBe(false)

    const result = resolver.resolve('sym:someFunction')
    expect(result.status).toBe('unverifiable')
    expect(result.detail).toBe('symbol index disabled in anchoring.config.json')
  })
})

describe('architecture block validation and defaults', () => {
  test('absent architecture leaves the property absent (not undefined)', () => {
    const res = parseConfig('/root', {})
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect('architecture' in res.config).toBe(false)
      expect(res.config.architecture).toBeUndefined()
    }
  })

  test('a minimal {"layers":[]} fills every default', () => {
    const res = parseConfig('/root', { architecture: { layers: [] } })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.config.architecture).toBeDefined()
      expect(res.config.architecture).toEqual({
        layers: [],
        moduleRoots: [],
        entryPoints: DEFAULT_ENTRY_POINTS,
        maxFileLines: DEFAULT_MAX_FILE_LINES,
        maxFunctionLines: DEFAULT_MAX_FUNCTION_LINES,
        impureImports: DEFAULT_IMPURE_IMPORTS,
      })
    }
  })

  test('rejects architecture when not an object', () => {
    for (const val of [null, 'not an object', 123, []]) {
      const res = parseConfig('/root', { architecture: val })
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.problems.some((p) => p.includes('`architecture` must be an object'))).toBe(true)
      }
    }
  })

  test('rejects unknown key inside architecture', () => {
    const res = parseConfig('/root', { architecture: { unknownKey: true } })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.problems.some((p) => p.includes('unknown key `unknownKey` under `architecture`'))).toBe(true)
      expect(res.problems.some((p) => p.includes('accepted keys are:'))).toBe(true)
    }
  })

  test('rejects layers when not an array of objects or layer has no non-empty name', () => {
    const notArray = parseConfig('/root', { architecture: { layers: 'not an array' } })
    expect(notArray.ok).toBe(false)
    if (!notArray.ok) {
      expect(notArray.problems.some((p) => p.includes('`architecture.layers` must be an array'))).toBe(true)
    }

    const badEntry = parseConfig('/root', { architecture: { layers: ['not-an-obj'] } })
    expect(badEntry.ok).toBe(false)
    if (!badEntry.ok) {
      expect(badEntry.problems.some((p) => p.includes('architecture.layers[0] must be an object'))).toBe(true)
    }

    const emptyName = parseConfig('/root', { architecture: { layers: [{ name: '', paths: ['src/'] }] } })
    expect(emptyName.ok).toBe(false)
    if (!emptyName.ok) {
      expect(emptyName.problems.some((p) => p.includes('layer at index 0 has no non-empty name'))).toBe(true)
    }
  })

  test('rejects two layers sharing a name', () => {
    const res = parseConfig('/root', {
      architecture: {
        layers: [
          { name: 'domain', paths: ['src/domain/'] },
          { name: 'domain', paths: ['src/core/'] },
        ],
      },
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.problems.some((p) => p.includes('two layers share the name `domain`'))).toBe(true)
    }
  })

  test('rejects a layer whose paths is not a non-empty array of non-empty strings', () => {
    const emptyPaths = parseConfig('/root', {
      architecture: {
        layers: [{ name: 'ui', paths: [] }],
      },
    })
    expect(emptyPaths.ok).toBe(false)
    if (!emptyPaths.ok) {
      expect(emptyPaths.problems.some((p) => p.includes('layer `ui` paths must be a non-empty array'))).toBe(true)
    }

    const invalidPaths = parseConfig('/root', {
      architecture: {
        layers: [{ name: 'ui', paths: [''] }],
      },
    })
    expect(invalidPaths.ok).toBe(false)
    if (!invalidPaths.ok) {
      expect(invalidPaths.problems.some((p) => p.includes('layer `ui` paths must be a non-empty array'))).toBe(true)
    }
  })

  test('rejects layer path that is absolute, contains .., or contains a backslash', () => {
    const absPath = parseConfig('/root', {
      architecture: { layers: [{ name: 'ui', paths: ['/abs/path'] }] },
    })
    expect(absPath.ok).toBe(false)
    if (!absPath.ok) {
      expect(absPath.problems.some((p) => p.includes('must be a repo-relative POSIX path'))).toBe(true)
    }

    const dotDot = parseConfig('/root', {
      architecture: { layers: [{ name: 'ui', paths: ['../parent/'] }] },
    })
    expect(dotDot.ok).toBe(false)
    if (!dotDot.ok) {
      expect(dotDot.problems.some((p) => p.includes('must be a repo-relative POSIX path'))).toBe(true)
    }

    const backslash = parseConfig('/root', {
      architecture: { layers: [{ name: 'ui', paths: ['src\\ui'] }] },
    })
    expect(backslash.ok).toBe(false)
    if (!backslash.ok) {
      expect(backslash.problems.some((p) => p.includes('must be a repo-relative POSIX path'))).toBe(true)
    }
  })

  test('rejects two layers claiming the same path or one being a prefix of another', () => {
    const samePath = parseConfig('/root', {
      architecture: {
        layers: [
          { name: 'ui', paths: ['src/shared/'] },
          { name: 'domain', paths: ['src/shared/'] },
        ],
      },
    })
    expect(samePath.ok).toBe(false)
    if (!samePath.ok) {
      expect(samePath.problems.some((p) => p.includes('claim overlapping paths'))).toBe(true)
    }

    const prefixPath = parseConfig('/root', {
      architecture: {
        layers: [
          { name: 'all', paths: ['src/'] },
          { name: 'domain', paths: ['src/domain/'] },
        ],
      },
    })
    expect(prefixPath.ok).toBe(false)
    if (!prefixPath.ok) {
      expect(prefixPath.problems.some((p) => p.includes('claim overlapping paths'))).toBe(true)
    }
  })

  test('rejects more than one layer with pure: true', () => {
    const res = parseConfig('/root', {
      architecture: {
        layers: [
          { name: 'domain', paths: ['src/domain/'], pure: true },
          { name: 'core', paths: ['packages/core/'], pure: true },
        ],
      },
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.problems.some((p) => p.includes('more than one layer has pure: true'))).toBe(true)
    }
  })

  test('rejects moduleRoots / entryPoints / impureImports when not arrays of non-empty strings', () => {
    const badRoots = parseConfig('/root', {
      architecture: { moduleRoots: 'invalid' },
    })
    expect(badRoots.ok).toBe(false)
    if (!badRoots.ok) {
      expect(badRoots.problems.some((p) => p.includes('`moduleRoots` must be an array of non-empty strings'))).toBe(true)
    }

    const badRootsPosix = parseConfig('/root', {
      architecture: { moduleRoots: ['/abs/root/'] },
    })
    expect(badRootsPosix.ok).toBe(false)
    if (!badRootsPosix.ok) {
      expect(badRootsPosix.problems.some((p) => p.includes('must be a repo-relative POSIX path'))).toBe(true)
    }

    const badEntry = parseConfig('/root', {
      architecture: { entryPoints: [] },
    })
    expect(badEntry.ok).toBe(false)
    if (!badEntry.ok) {
      expect(badEntry.problems.some((p) => p.includes('`entryPoints` must be an array of non-empty strings'))).toBe(true)
    }

    const badImpure = parseConfig('/root', {
      architecture: { impureImports: [123] },
    })
    expect(badImpure.ok).toBe(false)
    if (!badImpure.ok) {
      expect(badImpure.problems.some((p) => p.includes('`impureImports` must be an array of non-empty strings'))).toBe(true)
    }
  })

  test('rejects maxFileLines / maxFunctionLines when not positive integers', () => {
    const badFiles = parseConfig('/root', {
      architecture: { maxFileLines: -10 },
    })
    expect(badFiles.ok).toBe(false)
    if (!badFiles.ok) {
      expect(badFiles.problems.some((p) => p.includes('`maxFileLines` must be a positive integer'))).toBe(true)
    }

    const badFunc = parseConfig('/root', {
      architecture: { maxFunctionLines: '50' },
    })
    expect(badFunc.ok).toBe(false)
    if (!badFunc.ok) {
      expect(badFunc.problems.some((p) => p.includes('`maxFunctionLines` must be a positive integer'))).toBe(true)
    }
  })

  test('rejects maxFileLines < 50 or maxFunctionLines < 10 with threshold warning', () => {
    const lowFiles = parseConfig('/root', {
      architecture: { maxFileLines: 49 },
    })
    expect(lowFiles.ok).toBe(false)
    if (!lowFiles.ok) {
      expect(lowFiles.problems.some((p) => p.includes('maxFileLines must be at least 50 (a threshold nobody can meet is a threshold that gets switched off)'))).toBe(true)
    }

    const lowFunc = parseConfig('/root', {
      architecture: { maxFunctionLines: 9 },
    })
    expect(lowFunc.ok).toBe(false)
    if (!lowFunc.ok) {
      expect(lowFunc.problems.some((p) => p.includes('maxFunctionLines must be at least 10 (a threshold nobody can meet is a threshold that gets switched off)'))).toBe(true)
    }
  })

  test('path normalisation adds trailing slash to paths and moduleRoots', () => {
    const res = parseConfig('/root', {
      architecture: {
        layers: [
          { name: 'ui', paths: ['src/ui', 'apps'] },
        ],
        moduleRoots: ['src/modules', 'packages'],
      },
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.config.architecture?.layers[0]?.paths).toEqual(['src/ui/', 'apps/'])
      expect(res.config.architecture?.moduleRoots).toEqual(['src/modules/', 'packages/'])
    }
  })

  test('layer order is preserved verbatim', () => {
    const res = parseConfig('/root', {
      architecture: {
        layers: [
          { name: 'ui', paths: ['src/ui/'] },
          { name: 'app', paths: ['src/app/'] },
          { name: 'domain', paths: ['src/domain/'], pure: true },
          { name: 'infra', paths: ['src/infra/'] },
        ],
      },
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.config.architecture?.layers.map((l) => l.name)).toEqual([
        'ui',
        'app',
        'domain',
        'infra',
      ])
    }
  })
})
