import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ask, askStore, extractQueryTokens, scoreEntity, tokenise } from './ask.js'
import { defaultConfig } from './config.js'
import { renderAsk, PLAIN } from './render.js'
import { buildStore, type Entity } from './store.js'

function fixture(docs: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'kb-ask-'))
  for (const [path, body] of Object.entries(docs)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return root
}

const conf = (root: string) => defaultConfig(root)

describe('ask tokenisation and scoring', () => {
  test('tokenise drops stopwords and non-alphanumerics', () => {
    const tokens = tokenise('The quick, brown fox jumps over the lazy dog!')
    expect(tokens).toEqual(['quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog'])
  })

  test('extractQueryTokens falls back to raw tokens when all words are stopwords', () => {
    const tokens = extractQueryTokens('the and of')
    expect(tokens).toEqual(['the', 'and', 'of'])
  })

  test('scoreEntity weights tags x3, title x2, id x1', () => {
    const entityWithTags: Entity = {
      id: 'ADR-0001',
      kind: 'ADR',
      title: 'Something unrelated',
      status: 'accepted',
      path: 'docs/adr/0001.md',
      links: {},
      fields: { tags: JSON.stringify(['payment', 'webhook']) },
    }
    const entityWithTitle: Entity = {
      id: 'ADR-0002',
      kind: 'ADR',
      title: 'Payment webhook design',
      status: 'accepted',
      path: 'docs/adr/0002.md',
      links: {},
      fields: {},
    }
    const entityWithId: Entity = {
      id: 'ADR-PAYMENT',
      kind: 'ADR',
      title: 'Unrelated title here',
      status: 'accepted',
      path: 'docs/adr/payment.md',
      links: {},
      fields: {},
    }

    const queryTokens = ['payment']
    const scoreTags = scoreEntity(queryTokens, entityWithTags)
    const scoreTitle = scoreEntity(queryTokens, entityWithTitle)
    const scoreId = scoreEntity(queryTokens, entityWithId)

    // tags (1/2 * 3 = 1.5) vs title (1/3 * 2 = 0.667) vs id (1/2 * 1 = 0.5)
    expect(scoreTags).toBeGreaterThan(scoreTitle)
    expect(scoreTitle).toBeGreaterThan(scoreId)
  })

  test('scoreEntity length-normalises so concise titles win over diluted titles', () => {
    const concise: Entity = {
      id: 'ADR-0001',
      kind: 'ADR',
      title: 'Payment Webhook',
      status: 'accepted',
      path: 'docs/adr/0001.md',
      links: {},
      fields: {},
    }
    const diluted: Entity = {
      id: 'ADR-0002',
      kind: 'ADR',
      title: 'Architecture overview of payment system with many extra terms and words',
      status: 'accepted',
      path: 'docs/adr/0002.md',
      links: {},
      fields: {},
    }

    const queryTokens = ['payment']
    expect(scoreEntity(queryTokens, concise)).toBeGreaterThan(scoreEntity(queryTokens, diluted))
  })
})

describe('ask retrieval', () => {
  const CORPUS = {
    '.anchor/invariant/INV-DEP-DIRECTION.md':
      '---\nid: INV-DEP-DIRECTION\ntitle: Dependencies point one way, down the layer order\nstatus: active\n---\n',
    '.anchor/invariant/INV-PURE-CORE.md':
      '---\nid: INV-PURE-CORE\ntitle: Domain layer is pure\nstatus: active\n---\n',
    '.anchor/invariant/INV-INACTIVE.md':
      '---\nid: INV-INACTIVE\ntitle: Retired invariant\nstatus: retired\n---\n',
    '.anchor/hazard/HAZ-0001.md':
      '---\nid: HAZ-0001\ntitle: Open Hazard Title\nstatus: active\nsource: https://example.com/rep\nobserved: 2026-01-01\nrecorded: 2026-01-02\nresolution: open\n---\n',
    '.anchor/hazard/HAZ-0002.md':
      '---\nid: HAZ-0002\ntitle: Guarded Hazard Title\nstatus: active\nsource: https://example.com/rep2\nobserved: 2026-01-01\nrecorded: 2026-01-02\nresolution: guarded\n---\n',
    'docs/adr/0001-payment.md':
      '---\nid: ADR-0001\ntitle: Payment Webhook Architecture\nstatus: accepted\ntags:\n  - payment\n  - stripe\n---\n',
    'docs/adr/0002-auth.md':
      '---\nid: ADR-0002\ntitle: Authentication Tokens\nstatus: accepted\n---\n',
    '.anchor/work/W-1.md':
      '---\nid: W-1\ntitle: Implement payment webhook endpoint\nstatus: doing\n---\n',
    '.anchor/incident/INC-0001.md':
      '---\nid: INC-0001\ntitle: The CLI checked nothing and exited 0 when installed as a package\nstatus: fixed\n---\n',
  } as const

  test('always returns every active invariant in full, sorted by id ascending', () => {
    const root = fixture(CORPUS)
    const report = ask(conf(root), 'completely unrelated query')

    expect(report.invariants.map((i) => i.id)).toEqual(['INV-DEP-DIRECTION', 'INV-PURE-CORE'])
  })

  test('always returns every active open hazard, sorted by id ascending', () => {
    const root = fixture(CORPUS)
    const report = ask(conf(root), 'completely unrelated query')

    expect(report.openHazards.map((h) => h.id)).toEqual(['HAZ-0001'])
  })

  test('ranks matches by relevance and partitions by kind', () => {
    const root = fixture(CORPUS)
    const report = ask(conf(root), 'payment webhook')

    expect(report.ranked.ADR.map((m) => m.entity.id)).toEqual(['ADR-0001'])
    expect(report.ranked.WORK.map((m) => m.entity.id)).toEqual(['W-1'])
    expect(report.ranked.INC).toEqual([])
    expect(report.ranked.FLOW).toEqual([])
    expect(report.totalMatches).toBe(2)
  })

  test('breaks ties by id ascending deterministically', () => {
    const store = buildStore([
      {
        id: 'ADR-0002',
        kind: 'ADR',
        title: 'Webhook processing',
        status: 'accepted',
        path: 'docs/adr/0002.md',
        links: {},
        fields: {},
      },
      {
        id: 'ADR-0001',
        kind: 'ADR',
        title: 'Webhook processing',
        status: 'accepted',
        path: 'docs/adr/0001.md',
        links: {},
        fields: {},
      },
    ])

    const report = askStore(store, 'webhook')
    expect(report.ranked.ADR.map((m) => m.entity.id)).toEqual(['ADR-0001', 'ADR-0002'])
  })

  test('respects the limit option per kind', () => {
    const store = buildStore(
      Array.from({ length: 12 }, (_, i) => ({
        id: `ADR-${String(i + 1).padStart(4, '0')}`,
        kind: 'ADR' as const,
        title: `Payment module part ${i + 1}`,
        status: 'accepted',
        path: `docs/adr/${i + 1}.md`,
        links: {},
        fields: {},
      })),
    )

    const report = askStore(store, 'payment', { limit: 5 })
    expect(report.ranked.ADR.length).toBe(5)
  })

  test('includes doctrine files when present, and omits section when absent', () => {
    const withoutDoctrine = fixture(CORPUS)
    const report1 = ask(conf(withoutDoctrine), 'payment')
    expect(report1.doctrine.matched).toEqual([])
    expect(report1.doctrine.unmatched).toEqual([])
    const rendered1 = renderAsk(report1, PLAIN)
    expect(rendered1).not.toContain('Doctrine')

    const withDoctrine = fixture({
      ...CORPUS,
      '.anchor/doctrine/discipline/verification.md': '# Verification and honesty\n\nProse here.\n',
    })
    const report2 = ask(conf(withDoctrine), 'payment')
    // No frontmatter, and 'payment' matches nothing in it: listed, never ranked.
    expect(report2.doctrine.matched).toEqual([])
    expect(report2.doctrine.unmatched.length).toBe(1)
    expect(report2.doctrine.unmatched[0]?.name).toBe('discipline/verification.md')
    expect(report2.doctrine.unmatched[0]?.title).toBe('Verification and honesty')

    const rendered2 = renderAsk(report2, PLAIN)
    expect(rendered2).toContain('Doctrine')
    expect(rendered2).toContain('discipline/verification.md')
  })
})

describe('ask negative path and determinism', () => {
  const CORPUS = {
    '.anchor/invariant/INV-DEP-DIRECTION.md':
      '---\nid: INV-DEP-DIRECTION\ntitle: Dependencies point one way, down the layer order\nstatus: active\n---\n',
    '.anchor/incident/INC-0001.md':
      '---\nid: INC-0001\ntitle: The CLI checked nothing and exited 0 when installed as a package\nstatus: fixed\n---\n',
  } as const

  test('negative report speaks loudly and specifically for matching nothing', () => {
    const root = fixture(CORPUS)
    const report = ask(conf(root), 'quantum teleportation scheduler')

    expect(report.totalMatches).toBe(0)
    expect(report.corpusSize).toBe(2)

    const rendered = renderAsk(report, PLAIN)
    expect(rendered).toContain('No ranked matches for "quantum teleportation scheduler" (searched 2 entities).')
    expect(rendered).toContain('The invariants above still apply to all work in this repository.')
    expect(rendered).toContain('INV-DEP-DIRECTION')
  })

  test('output is byte-identical across two consecutive runs against unchanged corpus', () => {
    const root = fixture(CORPUS)
    const config = conf(root)

    const run1 = renderAsk(ask(config, 'teleportation'), PLAIN)
    const run2 = renderAsk(ask(config, 'teleportation'), PLAIN)
    expect(run1).toBe(run2)

    const run3 = renderAsk(ask(config, 'cli package'), PLAIN)
    const run4 = renderAsk(ask(config, 'cli package'), PLAIN)
    expect(run3).toBe(run4)
  })
})
