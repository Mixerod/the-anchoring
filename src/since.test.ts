import { describe, expect, test } from 'vitest'
import { affectedEntities, filterSince, findingSubject } from './since.js'
import { buildStore, type Entity } from './store.js'
import { renderSince } from './render.js'
import { PLAIN } from './render.js'
import type { Finding } from './finding.js'

function entity(id: string, path: string, links: Record<string, readonly string[]> = {}): Entity {
  return {
    id,
    kind: id.startsWith('ADR') ? 'ADR' : 'INV',
    title: `${id} title`,
    status: id.startsWith('ADR') ? 'accepted' : 'active',
    path,
    links,
    fields: {},
  }
}

const STORE = buildStore([
  entity('ADR-0001', 'docs/adr/0001-a.md', { governs: ['file:src/pay/'] }),
  entity('ADR-0002', 'docs/adr/0002-b.md', { governs: ['file:src/other.ts'] }),
  entity('INV-SYM', '.anchor/invariant/INV-SYM.md', { enforced_by: ['sym:createResolver'] }),
])

const finding = (where: string, severity: Finding['severity'] = 'error'): Finding => ({
  severity,
  where,
  message: `${where} is wrong`,
})

describe('findingSubject', () => {
  test('reads the entity id out of both shapes a checker writes', () => {
    expect(findingSubject('ADR-0001')).toBe('ADR-0001')
    expect(findingSubject('ADR-0001 · governs')).toBe('ADR-0001')
  })

  test('falls back to the path a load problem uses', () => {
    expect(findingSubject('docs/adr/0003-broken.md')).toBe('docs/adr/0003-broken.md')
  })
})

describe('affectedEntities', () => {
  test('includes an entity whose own document changed', () => {
    const ids = affectedEntities(STORE, ['docs/adr/0002-b.md']).map((e) => e.id)

    expect(ids).toEqual(['ADR-0002'])
  })

  test('includes an entity whose anchor points at a changed file', () => {
    // The important half: a decision does not have to be edited to become wrong. Its anchor
    // rots when the code it names moves.
    const ids = affectedEntities(STORE, ['src/pay/webhook.ts']).map((e) => e.id)

    expect(ids).toEqual(['ADR-0001'])
  })

  test('a directory anchor covers files beneath it', () => {
    // `file:src/pay/` must cover `src/pay/webhook.ts`. The naive `${anchor}/` builds
    // `src/pay//` and matches nothing — a live false positive in `kb done` before this was
    // shared, where `file:src/` failed to explain a single file under `src/`.
    const ids = affectedEntities(STORE, ['src/pay/webhook.ts']).map((e) => e.id)

    expect(ids).toEqual(['ADR-0001'])
  })

  test('excludes an entity that neither changed nor anchors the diff', () => {
    expect(affectedEntities(STORE, ['README.md'])).toEqual([])
  })

  test('reaches a symbol-anchored entity only through its own document', () => {
    expect(affectedEntities(STORE, ['src/resolver.ts'])).toEqual([])
    expect(affectedEntities(STORE, ['.anchor/invariant/INV-SYM.md']).map((e) => e.id)).toEqual([
      'INV-SYM',
    ])
  })
})

describe('filterSince', () => {
  const findings = [finding('ADR-0001 · governs'), finding('ADR-0002'), finding('INV-SYM')]

  test('keeps only findings about affected entities', () => {
    const report = filterSince(STORE, findings, ['src/pay/webhook.ts'], 'HEAD~1')

    expect(report.findings.map((f) => f.where)).toEqual(['ADR-0001 · governs'])
    expect(report.affected).toEqual(['ADR-0001'])
  })

  test('keeps a load problem keyed by a changed path', () => {
    const problem = finding('docs/adr/0009-unparseable.md')
    const report = filterSince(STORE, [problem], ['docs/adr/0009-unparseable.md'], 'HEAD~1')

    expect(report.findings).toEqual([problem])
  })

  test('returns nothing when the diff touches nothing documented', () => {
    expect(filterSince(STORE, findings, ['README.md'], 'HEAD~1').findings).toEqual([])
  })
})

describe('renderSince — the case where it must speak', () => {
  test('says "no files changed" in words rather than printing nothing', () => {
    // A command that checked nothing and printed nothing is indistinguishable from a broken
    // one. That is INC-0001, and this repository has already paid for it once.
    const out = renderSince(filterSince(STORE, [], [], 'HEAD~1'), PLAIN)

    expect(out).toContain('no files changed since `HEAD~1`')
    expect(out.trim().length).toBeGreaterThan(0)
  })

  test('says "no entities changed" when files moved but nothing documented did', () => {
    const out = renderSince(filterSince(STORE, [], ['README.md'], 'main'), PLAIN)

    expect(out).toContain('no entities changed since `main`')
    expect(out).toContain('1 file(s) changed')
  })

  test('names the ref and the affected count on a clean delta', () => {
    const out = renderSince(filterSince(STORE, [], ['docs/adr/0002-b.md'], 'HEAD~1'), PLAIN)

    expect(out).toContain('kb verify: clean')
    expect(out).toContain('1 entity(ies) affected since HEAD~1')
  })

  test('reports findings for the affected entities', () => {
    const out = renderSince(
      filterSince(STORE, [finding('ADR-0002')], ['docs/adr/0002-b.md'], 'HEAD~1'),
      PLAIN,
    )

    expect(out).toContain('ADR-0002')
    expect(out).toContain('1 error(s), 0 warning(s)')
  })
})
