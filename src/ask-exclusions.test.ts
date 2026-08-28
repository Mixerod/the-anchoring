import { describe, expect, test } from 'vitest'
import { askStore } from './ask.js'
import { buildStore, type Entity } from './store.js'
import { renderAsk, PLAIN } from './render.js'
import type { EntityKind } from './model.js'

function entity(
  id: string,
  kind: EntityKind,
  status: string,
  fields: Record<string, string> = {},
): Entity {
  return {
    id,
    kind,
    title: `${id} about payments`,
    status,
    path: `.anchor/${kind.toLowerCase()}/${id}.md`,
    links: {},
    fields,
  }
}

const STORE = buildStore([
  entity('INV-A', 'INV', 'active'),
  entity('INV-OLD', 'INV', 'retired'),
  entity('ADR-0001', 'ADR', 'accepted'),
  entity('ADR-0002', 'ADR', 'superseded'),
  entity('ADR-0003', 'ADR', 'void'),
  entity('FLOW-0001', 'FLOW', 'live'),
  entity('W-1', 'WORK', 'doing'),
  entity('INC-0001', 'INC', 'fixed'),
  entity('HAZ-0001', 'HAZ', 'active', { resolution: 'open' }),
  entity('HAZ-0002', 'HAZ', 'active', { resolution: 'guarded' }),
  entity('HAZ-0003', 'HAZ', 'active', { resolution: 'guarded' }),
  entity('HAZ-0004', 'HAZ', 'active', { resolution: 'accepted' }),
])

const ask = (query: string, limit?: number) =>
  askStore(STORE, query, limit !== undefined ? { limit } : {})

describe('what kb ask leaves out', () => {
  test('counts the entities it searched and how many scored zero', () => {
    const x = ask('nothing matches this').exclusions

    // ADR-0001, FLOW-0001, W-1, INC-0001 — superseded and void ADRs are not ranked.
    expect(x.searched).toBe(4)
    expect(x.scoredZero).toBe(4)
  })

  test('counts hazards held back, grouped by the decision already taken', () => {
    const x = ask('payments').exclusions

    expect(x.hazards).toEqual([
      { resolution: 'accepted', count: 1 },
      { resolution: 'guarded', count: 2 },
    ])
  })

  test('counts retired invariants and superseded decisions', () => {
    const x = ask('payments').exclusions

    expect(x.retiredInvariants).toBe(1)
    expect(x.supersededDecisions).toBe(2)
  })

  test('counts matches ranked below the limit', () => {
    // Found, ranked, and then not shown is still an exclusion. Needs two matches of one
    // kind, since the limit applies per kind.
    const crowded = buildStore([
      entity('W-1', 'WORK', 'doing'),
      entity('W-2', 'WORK', 'doing'),
      entity('W-3', 'WORK', 'doing'),
    ])

    const report = askStore(crowded, 'payments', { limit: 1 })

    expect(report.ranked.WORK).toHaveLength(1)
    expect(report.exclusions.truncated).toBe(2)
  })

  test('names the kinds that are returned in full rather than ranked', () => {
    expect(ask('payments').exclusions.alwaysReturned).toEqual(['INV', 'HAZ'])
  })
})

describe('what kb ask must keep returning', () => {
  test('every active invariant, on every query, matching or not', () => {
    // An invariant that applies only when a keyword matches is not an invariant.
    expect(ask('quantum teleportation scheduler').invariants.map((e) => e.id)).toEqual(['INV-A'])
  })

  test('every open hazard, for the same reason', () => {
    expect(ask('quantum teleportation scheduler').openHazards.map((e) => e.id)).toEqual([
      'HAZ-0001',
    ])
  })
})

describe('rendering', () => {
  test('the exclusions section reports counts, never the excluded entities', () => {
    const out = renderAsk(ask('payments'), PLAIN)

    expect(out).toContain('Not shown')
    expect(out).toContain('2 hazard(s) held back: resolution `guarded`')
    expect(out).toContain('1 retired invariant(s) excluded')
    expect(out).toContain('2 superseded decision(s) excluded')
    // Listing them would reintroduce exactly the token cost this layer removes.
    expect(out).not.toContain('HAZ-0002')
    expect(out).not.toContain('ADR-0002')
    expect(out).not.toContain('INV-OLD')
  })

  test('the negative report keeps its counts when nothing matches', () => {
    const out = renderAsk(ask('quantum teleportation scheduler'), PLAIN)

    expect(out).toContain('No ranked matches')
    expect(out).toContain('searched 4 entities; 4 scored zero')
  })

  test('output is byte-identical across two runs', () => {
    expect(renderAsk(ask('payments'), PLAIN)).toBe(renderAsk(ask('payments'), PLAIN))
  })
})
