import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createResolver, parseAnchor } from './anchors.js'
import { defaultConfig } from './config.js'

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'kb-anchor-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'real.ts'), 'export const x = 1\n')
  return root
}

const conf = (root: string) => defaultConfig(root)

describe('parseAnchor', () => {
  test('reads the two supported forms', () => {
    expect(parseAnchor('file:packages/core/src/state.ts')).toEqual({
      form: 'file',
      value: 'packages/core/src/state.ts',
    })
    expect(parseAnchor('sym:applyCommand')).toEqual({ form: 'sym', value: 'applyCommand' })
  })

  test('accepts a dotted symbol path', () => {
    expect(parseAnchor('sym:Ruleset.tempoPerSquare')).toEqual({
      form: 'sym',
      value: 'Ruleset.tempoPerSquare',
    })
  })

  test('rejects an unprefixed value, so a bare path can never be mistaken for an anchor', () => {
    expect(parseAnchor('packages/core/src/state.ts')).toBeUndefined()
  })

  test('rejects an unknown prefix', () => {
    expect(parseAnchor('line:packages/core/src/state.ts:42')).toBeUndefined()
  })

  test('rejects a symbol carrying shell metacharacters', () => {
    // The value reaches spawnSync with shell:true, so this rejection is a security
    // boundary, not a style preference.
    expect(parseAnchor('sym:foo; rm -rf /')).toBeUndefined()
    expect(parseAnchor('sym:$(whoami)')).toBeUndefined()
    expect(parseAnchor('sym:a`b`')).toBeUndefined()
  })

  test('rejects an empty value', () => {
    expect(parseAnchor('file:')).toBeUndefined()
    expect(parseAnchor('sym:  ')).toBeUndefined()
  })
})

describe('createResolver', () => {
  test('resolves a path that exists', () => {
    const resolver = createResolver(conf(scratch()))

    expect(resolver.resolve('file:src/real.ts').status).toBe('resolved')
  })

  test('reports a path that does not exist as missing', () => {
    const result = createResolver(conf(scratch())).resolve('file:src/gone.ts')

    expect(result.status).toBe('missing')
    expect(result.detail).toBe('no such file')
  })

  test('reports a malformed anchor rather than silently ignoring it', () => {
    const result = createResolver(conf(scratch())).resolve('packages/core/src/state.ts')

    expect(result.status).toBe('malformed')
  })

  test('downgrades symbol anchors to unverifiable when no codegraph index exists', () => {
    const resolver = createResolver(conf(scratch()))

    expect(resolver.indexed).toBe(false)
    expect(resolver.resolve('sym:applyCommand')).toMatchObject({
      status: 'unverifiable',
      detail: expect.stringContaining('codegraph init'),
    })
  })

  test('caches a result so a repeated anchor costs one lookup', () => {
    const resolver = createResolver(conf(scratch()))

    expect(resolver.resolve('file:src/real.ts')).toBe(resolver.resolve('file:src/real.ts'))
  })
})

describe('createResolver, with an index present', () => {
  function indexedScratch(): string {
    const root = scratch()
    mkdirSync(join(root, '.codegraph'), { recursive: true })
    return root
  }

  test('resolves a symbol the index knows', () => {
    const resolver = createResolver(conf(indexedScratch()), () => true)

    expect(resolver.indexed).toBe(true)
    expect(resolver.resolve('sym:applyCommand').status).toBe('resolved')
  })

  test('reports a symbol the index does not know as missing', () => {
    const result = createResolver(conf(indexedScratch()), () => false).resolve('sym:renamedAway')

    expect(result).toMatchObject({ status: 'missing', detail: 'symbol not found in the index' })
  })

  test('reports a failed lookup as unverifiable, never as absent', () => {
    // A crashed or stale codegraph must not be able to fail the build with a false
    // "this symbol is gone" — silence is not evidence.
    const result = createResolver(conf(indexedScratch()), () => undefined).resolve('sym:applyCommand')

    expect(result).toMatchObject({ status: 'unverifiable', detail: 'codegraph query failed' })
  })

  test('passes the repo root and bare symbol name to the probe', () => {
    const seen: Array<readonly [string, string]> = []
    const root = indexedScratch()
    createResolver(conf(root), (r, n) => {
      seen.push([r, n])
      return true
    }).resolve('sym:Ruleset.tempoPerSquare')

    expect(seen).toEqual([[root, 'Ruleset.tempoPerSquare']])
  })
})
