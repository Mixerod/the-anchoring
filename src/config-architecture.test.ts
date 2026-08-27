/**
 * Tests for the `architecture` block, split out of config.test.ts.
 *
 * Mirrors the source split: `config.ts` owns the core/defaults/kind validation,
 * `config-architecture.ts` owns the dependency matrix. The seam is the same one.
 */
import { describe, expect, test } from 'vitest'
import {
  parseConfig,
  DEFAULT_ENTRY_POINTS,
  DEFAULT_IMPURE_IMPORTS,
  DEFAULT_MAX_FILE_LINES,
  DEFAULT_MAX_FUNCTION_LINES,
} from './config.js'

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

describe('the split itself (T13c)', () => {
  test('both halves of the old config.test.ts are under the 400-line ceiling', async () => {
    const { readFileSync } = await import('node:fs')
    for (const file of ['src/config.test.ts', 'src/config-architecture.test.ts']) {
      const lines = readFileSync(file, 'utf8').split('\n').length
      expect(lines, `${file} is ${lines} lines`).toBeLessThanOrEqual(400)
    }
  })
})
