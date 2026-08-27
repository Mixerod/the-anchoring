import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ctx } from './ctx.js'
import { defaultConfig } from './config.js'

function fixture(docs: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'kb-ctx-'))
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
    'constrains:\n  - INV-TEMPO-BITES\ngoverns:\n  - file:packages/core/src/tempo\n---\n',
  '.anchor/invariant/INV-TEMPO-BITES.md':
    '---\nid: INV-TEMPO-BITES\ntitle: Tempo must bite\nstatus: active\n---\n',
  '.anchor/incident/INC-0007.md':
    '---\nid: INC-0007\ntitle: Replay desync\nstatus: fixed\n' +
    'touches:\n  - file:packages/core/src/tempo/costs.ts\n---\n',
  '.anchor/work/W-112.md':
    '---\nid: W-112\ntitle: Tune knight leap cost\nstatus: doing\n' +
    'implements:\n  - ADR-0003\ncloses:\n  - INC-0007\n' +
    'touches:\n  - file:packages/core/src/tempo/costs.ts\n' +
    'blocked_by:\n  - W-99\n---\n',
  '.anchor/work/W-99.md': '---\nid: W-99\ntitle: Replace the LCG\nstatus: todo\n---\n',
  '.anchor/work/W-100.md':
    '---\nid: W-100\ntitle: Earlier tempo work\nstatus: done\n' +
    'touches:\n  - file:packages/core/src/tempo/costs.ts\n---\n',
} as const

const section = (root: string, id: string, heading: string) =>
  ctx(conf(root), id).sections.find((s) => s.heading === heading)

describe('ctx', () => {
  test('names the decision the work claims to implement', () => {
    const found = section(fixture(REPO), 'W-112', 'Decides this work')

    expect(found?.entries.map((e) => e.id)).toEqual(['ADR-0003'])
  })

  test('reaches invariants through the decision, which the work never names directly', () => {
    // This is the whole point of a graph: W-112 says nothing about INV-TEMPO-BITES,
    // but it is bound by it via ADR-0003.
    const found = section(fixture(REPO), 'W-112', 'Must still hold')

    expect(found?.entries.map((e) => e.id)).toEqual(['INV-TEMPO-BITES'])
  })

  test('lists blockers and closed incidents', () => {
    const root = fixture(REPO)

    expect(section(root, 'W-112', 'Blocked by')?.entries.map((e) => e.id)).toEqual(['W-99'])
    expect(section(root, 'W-112', 'Closes')?.entries.map((e) => e.id)).toEqual(['INC-0007'])
  })

  test('surfaces prior records on the same code as the work touches', () => {
    const found = section(fixture(REPO), 'W-112', 'Has happened here before')

    // INC-0007 is already listed under Closes, so it must not be repeated here.
    expect(found?.entries.map((e) => e.id)).toEqual(['W-100'])
  })

  test('returns the anchors so the agent can hand them to codegraph', () => {
    expect(ctx(conf(fixture(REPO)), 'W-112').anchors).toEqual(['file:packages/core/src/tempo/costs.ts'])
  })

  test('gives every empty section a note, so silence never reads as "nothing applies"', () => {
    const report = ctx(conf(fixture(REPO)), 'W-99')

    expect(report.sections.every((s) => s.entries.length > 0 || s.emptyNote.length > 0)).toBe(true)
  })

  test('reports no subject for an unknown work id', () => {
    const report = ctx(conf(fixture(REPO)), 'W-404')

    expect(report.subject).toBeUndefined()
    expect(report.sections).toEqual([])
  })
})
