import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  checkAnchors,
  parseAnchor,
  parseProbeOutput,
  type AnchorStatus,
  type Resolver,
} from './anchors.js'
import { createResolver } from './resolver.js'
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
    expect(parseAnchor('file:src/state.ts')).toEqual({
      form: 'file',
      value: 'src/state.ts',
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
    expect(parseAnchor('src/state.ts')).toBeUndefined()
  })

  test('rejects an unknown prefix', () => {
    expect(parseAnchor('line:src/state.ts:42')).toBeUndefined()
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
    const result = createResolver(conf(scratch())).resolve('src/state.ts')

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

describe('parseProbeOutput (T13d)', () => {
  test('a bare array payload with rows means found', () => {
    expect(parseProbeOutput('[{"name":"x"}]')).toBe(true)
  })

  test('a {results:[]} payload means not found, not "cannot tell"', () => {
    expect(parseProbeOutput('{"results":[]}')).toBe(false)
    expect(parseProbeOutput('{"results":[{"name":"x"}]}')).toBe(true)
  })

  test('a {symbols:[…]} payload is read the same way', () => {
    expect(parseProbeOutput('{"symbols":[{"name":"x"}]}')).toBe(true)
    expect(parseProbeOutput('{"symbols":[]}')).toBe(false)
  })

  test('empty output cannot be told apart from a failure, so it is undefined', () => {
    expect(parseProbeOutput('')).toBeUndefined()
  })

  test('malformed JSON is undefined, never false', () => {
    // The distinction matters: `false` becomes `missing` (an error), `undefined` becomes
    // `unverifiable` (a warning). A parse failure must never be read as "the symbol is gone".
    expect(parseProbeOutput('{not json')).toBeUndefined()
    expect(parseProbeOutput('codegraph: command not found')).toBeUndefined()
  })

  test('a JSON payload of an unexpected shape is not found', () => {
    expect(parseProbeOutput('{"total":3}')).toBe(false)
    // A bare `null` is valid JSON but has no properties to read, so it lands in the
    // catch and reports "cannot tell" rather than "not found".
    expect(parseProbeOutput('null')).toBeUndefined()
  })
})

describe('checkAnchors over a stub resolver', () => {
  const entity = {
    id: 'ADR-0001',
    kind: 'ADR' as const,
    title: 'T',
    status: 'accepted',
    path: 'docs/adr/ADR-0001.md',
    fields: {},
    links: {
      governs: ['file:src/present.ts', 'file:src/gone.ts', 'sym:unindexed', 'file:'],
      constrains: ['INV-X'],
    },
  }

  const stub = (statuses: Readonly<Record<string, AnchorStatus>>): Resolver => ({
    indexed: false,
    resolve: (raw) => ({ raw, status: statuses[raw] ?? 'resolved' }),
  })

  test('counts every anchor and ignores entity references', () => {
    const { count } = checkAnchors(entity, stub({}))
    // Four values carry an anchor prefix, including the empty `file:`; `INV-X` does not
    // and is never counted — counting is by prefix, and validity is the resolver's job.
    expect(count).toBe(4)
  })

  test('a missing anchor is an error carrying the update hint', () => {
    const { findings } = checkAnchors(entity, stub({ 'file:src/gone.ts': 'missing' }))
    expect(findings.length).toBe(1)
    expect(findings[0]?.severity).toBe('error')
    expect(findings[0]?.where).toBe('ADR-0001 · governs')
    expect(findings[0]?.hint).toContain('no longer exists')
  })

  test('an unverifiable anchor warns rather than errors', () => {
    const { findings } = checkAnchors(entity, stub({ 'sym:unindexed': 'unverifiable' }))
    expect(findings.map((f) => f.severity)).toEqual(['warn'])
  })

  test('a malformed anchor is an error with no hint', () => {
    const { findings } = checkAnchors(entity, stub({ 'file:src/present.ts': 'malformed' }))
    expect(findings[0]?.severity).toBe('error')
    expect(findings[0]?.message).toContain('is malformed')
    expect(findings[0]?.hint).toBeUndefined()
  })

  test('every anchor resolving produces no findings', () => {
    expect(checkAnchors(entity, stub({})).findings).toEqual([])
  })
})
