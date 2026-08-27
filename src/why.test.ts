import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { why } from './why.js'
import { defaultConfig } from './config.js'

function fixture(docs: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'kb-why-'))
  for (const [path, body] of Object.entries(docs)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return root
}

const conf = (root: string) => defaultConfig(root)

const REPO = {
  'docs/adr/0003-tempo.md':
    '---\nid: ADR-0003\ntitle: Tempo Pool\nstatus: accepted\n' +
    'governs:\n  - file:src/tempo/costs.ts\n' +
    'constrains:\n  - INV-TEMPO-BITES\n' +
    'verified_by:\n  - file:src/tempo/tempo.test.ts\n---\n',
  '.anchor/invariant/INV-TEMPO-BITES.md':
    '---\nid: INV-TEMPO-BITES\ntitle: Tempo must bite\nstatus: active\n' +
    'holds_for:\n  - file:src/tempo\n---\n',
  '.anchor/flow/FLOW-0001.md':
    '---\nid: FLOW-0001\ntitle: Player reads the cost of a move\nstatus: draft\n' +
    'served_by:\n  - file:src/tempo/costs.ts\n' +
    'decided_by:\n  - ADR-0003\n---\n',
} as const

describe('why, on a code path', () => {
  test('names every entity that anchors to the file, and how', () => {
    const report = why(conf(fixture(REPO)), 'src/tempo/costs.ts')

    expect(report.mentions.map((m) => [m.entity.id, m.phrase])).toEqual([
      ['ADR-0003', 'is governed by'],
      ['FLOW-0001', 'serves'],
    ])
  })

  test('matches a directory anchor for a file beneath it', () => {
    const report = why(conf(fixture(REPO)), 'src/tempo')

    expect(report.mentions.map((m) => m.entity.id)).toContain('INV-TEMPO-BITES')
  })

  test('accepts a Windows-style path, because that is what a terminal will paste', () => {
    const report = why(conf(fixture(REPO)), 'src\\tempo\\costs.ts')

    expect(report.mentions.map((m) => m.entity.id)).toEqual(['ADR-0003', 'FLOW-0001'])
  })

  test('accepts a leading ./ without treating it as a different path', () => {
    const report = why(conf(fixture(REPO)), './src/tempo/costs.ts')

    expect(report.mentions).toHaveLength(2)
  })

  test('returns nothing for code no document claims', () => {
    const report = why(conf(fixture(REPO)), 'packages/sim/src/rng.ts')

    expect(report.mentions).toEqual([])
    expect(report.subject).toBeUndefined()
  })

  test('does not match a sibling directory that shares a name prefix', () => {
    const report = why(conf(fixture(REPO)), 'src/temp')

    expect(report.mentions).toEqual([])
  })
})

describe('why, on an entity id', () => {
  test('lists what the entity points at', () => {
    const report = why(conf(fixture(REPO)), 'ADR-0003')

    expect(report.subject?.title).toBe('Tempo Pool')
    expect(report.outgoing.map((o) => [o.field, o.target.id])).toEqual([
      ['constrains', 'INV-TEMPO-BITES'],
    ])
  })

  test('lists what points back at the entity', () => {
    const report = why(conf(fixture(REPO)), 'INV-TEMPO-BITES')

    expect(report.incoming.map((i) => [i.source.id, i.field])).toEqual([['ADR-0003', 'constrains']])
  })

  test('reports both directions for an entity in the middle of a chain', () => {
    const report = why(conf(fixture(REPO)), 'ADR-0003')

    expect(report.incoming.map((i) => i.source.id)).toEqual(['FLOW-0001'])
  })

  test('does not report anchor mentions for an entity subject', () => {
    // Anchors describe code; asking about an entity should answer with the graph.
    expect(why(conf(fixture(REPO)), 'ADR-0003').mentions).toEqual([])
  })
})
