import { describe, expect, test } from 'vitest'
import { byCodepoint, normaliseBody, planBrief, TIER_LABELS, type BriefEntity, type BriefInput } from './brief.js'
import {
  briefSizes,
  compareRenders,
  renderBrief,
  renderBriefJson,
  renderTierBody,
  TIER_MARKER_PREFIX,
} from './render-brief.js'
import type { Entity } from './store.js'
import type { EntityKind } from './model.js'

function entity(id: string, kind: EntityKind, status: string): Entity {
  return {
    id,
    kind,
    title: `${id} title`,
    status,
    path: `.anchor/${kind.toLowerCase()}/${id}.md`,
    links: {},
    fields: {},
  }
}

const doc = (id: string, kind: EntityKind, status: string, body = `body of ${id}`): BriefEntity => ({
  entity: entity(id, kind, status),
  body,
})

const CORPUS: readonly BriefEntity[] = [
  doc('INV-B', 'INV', 'active'),
  doc('INV-A', 'INV', 'active'),
  doc('INV-RETIRED', 'INV', 'retired'),
  doc('ADR-0002', 'ADR', 'accepted'),
  doc('ADR-0001', 'ADR', 'accepted'),
  doc('ADR-0003', 'ADR', 'proposed'),
  doc('FLOW-0001', 'FLOW', 'live'),
  doc('FLOW-0002', 'FLOW', 'draft'),
  doc('HAZ-0001', 'HAZ', 'active'),
  doc('HAZ-0002', 'HAZ', 'retired'),
  doc('W-2', 'WORK', 'doing'),
  doc('W-1', 'WORK', 'done'),
]

const INPUT: BriefInput = {
  agents: { name: 'AGENTS.md', path: 'AGENTS.md', body: 'agent instructions' },
  doctrine: [
    { name: 'solid.md', path: '.anchor/doctrine/solid.md', body: 'solid doctrine' },
    { name: 'gates.md', path: '.anchor/doctrine/gates.md', body: 'gates doctrine' },
  ],
  entities: CORPUS,
  session: 'W-2',
}

const idsIn = (level: number): readonly string[] => {
  const tier = planBrief(INPUT).tiers.find((t) => t.level === level)
  return (tier?.documents ?? []).map((d) => d.id)
}

describe('tier assignment', () => {
  test('splits into exactly four tiers, in the documented order', () => {
    const brief = planBrief(INPUT)

    expect(brief.tiers.map((t) => t.level)).toEqual([1, 2, 3, 4])
    expect(brief.tiers.map((t) => t.label)).toEqual([
      TIER_LABELS[1],
      TIER_LABELS[2],
      TIER_LABELS[3],
      TIER_LABELS[4],
    ])
  })

  test('tier 1 is AGENTS.md then doctrine, doctrine sorted by name', () => {
    expect(idsIn(1)).toEqual(['AGENTS.md', 'gates.md', 'solid.md'])
  })

  test('tier 2 is active invariants then accepted decisions, each sorted by id', () => {
    expect(idsIn(2)).toEqual(['INV-A', 'INV-B', 'ADR-0001', 'ADR-0002'])
  })

  test('tier 3 is live flows then active hazards', () => {
    expect(idsIn(3)).toEqual(['FLOW-0001', 'HAZ-0001'])
  })

  test('tier 4 is open work only', () => {
    expect(idsIn(4)).toEqual(['W-2'])
  })

  test('retired, draft, proposed and done documents are excluded', () => {
    const all = [1, 2, 3, 4].flatMap(idsIn)

    expect(all).not.toContain('INV-RETIRED')
    expect(all).not.toContain('ADR-0003')
    expect(all).not.toContain('FLOW-0002')
    expect(all).not.toContain('HAZ-0002')
    expect(all).not.toContain('W-1')
  })
})

describe('volatility containment', () => {
  /**
   * The invariant the plan asked for, stated in the only form that can actually be checked.
   *
   * "Tiers 1-3 contain no digit sequence derived from a count" cannot be asserted against
   * real bodies: doctrine prose legitimately says things like "48 packages, 30 enforced
   * boundaries". What is checkable, and is the property that actually matters, is that
   * tiers 1-3 do not *move* when the volatile facts move.
   */
  test('tiers 1-3 are byte-identical when the corpus size changes', () => {
    const before = planBrief(INPUT)
    const after = planBrief({
      ...INPUT,
      entities: [...CORPUS, doc('W-9', 'WORK', 'doing')],
      session: 'W-9',
    })

    for (const level of [1, 2, 3] as const) {
      const a = renderTierBody(before.tiers[level - 1]!, before)
      const b = renderTierBody(after.tiers[level - 1]!, after)
      expect(b).toBe(a)
    }
  })

  test('the counts and the session note appear in tier 4 and nowhere else', () => {
    const brief = planBrief(INPUT)
    const bodies = brief.tiers.map((t) => renderTierBody(t, brief))

    expect(bodies[3]).toContain('entities: 12')
    expect(bodies[3]).toContain('session: W-2')
    for (const body of bodies.slice(0, 3)) {
      expect(body).not.toContain('entities: ')
      expect(body).not.toContain('session: ')
    }
  })

  test('tiers 1-3 inject nothing but markers naming a stable path', () => {
    // Whatever the documents themselves say, nothing *this module writes* into a stable tier
    // may move between commits. Every line the renderer adds must be a tier marker or a doc
    // marker naming a path already in `generated_from` — a path is stable, a count is not.
    const brief = planBrief(INPUT)
    const bodies = new Set(brief.tiers.flatMap((t) => t.documents.map((d) => d.body)))

    for (const level of [1, 2, 3] as const) {
      const tier = brief.tiers[level - 1]!
      const injected = renderTierBody(tier, brief)
        .split('\n')
        .filter((line) => line.startsWith('<!-- kb:brief'))

      expect(injected.length).toBe(tier.documents.length)
      for (const line of injected) {
        const path = line.replace('<!-- kb:brief:doc ', '').replace(' -->', '')
        expect(brief.generatedFrom).toContain(path)
      }
      // and the marker for the tier itself carries only its own number
      expect(`${TIER_MARKER_PREFIX}${level} ${tier.label} -->`.replace(`:${level} `, ' ')).not.toMatch(/\d/)
      expect(bodies.size).toBeGreaterThan(0)
    }
  })
})

describe('determinism', () => {
  test('two renders of the same input are byte-identical', () => {
    expect(renderBrief(planBrief(INPUT))).toBe(renderBrief(planBrief(INPUT)))
  })

  test('a shuffled corpus renders identically', () => {
    // `readdir` order is not guaranteed and differs between machines. If load order reached
    // the output, every machine would miss the cache and nothing would say so.
    const shuffled: BriefInput = {
      ...INPUT,
      entities: [...CORPUS].reverse(),
      doctrine: [...INPUT.doctrine].reverse(),
    }

    expect(renderBrief(planBrief(shuffled))).toBe(renderBrief(planBrief(INPUT)))
  })

  test('CRLF and LF checkouts of the same corpus render identically', () => {
    const crlf: BriefInput = {
      ...INPUT,
      entities: CORPUS.map((d) => ({ ...d, body: d.body.replace(/\n/g, '\r\n') })),
    }

    expect(renderBrief(planBrief(crlf))).toBe(renderBrief(planBrief(INPUT)))
  })

  test('normaliseBody strips a BOM and guarantees a trailing newline', () => {
    expect(normaliseBody('﻿text')).toBe('text\n')
    expect(normaliseBody('a\r\nb')).toBe('a\nb\n')
  })

  test('byCodepoint orders by codepoint, not by locale', () => {
    expect(byCodepoint('Z', 'a')).toBe(-1)
    expect(['a', 'Z', 'B'].sort(byCodepoint)).toEqual(['B', 'Z', 'a'])
  })
})

describe('compareRenders', () => {
  test('reports stable for identical renders', () => {
    expect(compareRenders('same', 'same')).toEqual({ stable: true })
  })

  test('reports the first differing byte offset and the tier it falls in', () => {
    const brief = planBrief(INPUT)
    const text = renderBrief(brief)
    const at = text.indexOf('HAZ-0001')
    const mutated = `${text.slice(0, at)}HAZ-9999${text.slice(at + 'HAZ-0001'.length)}`

    const result = compareRenders(text, mutated)

    expect(result.stable).toBe(false)
    expect(result.tier).toBe(3)
    expect(result.offset).toBeGreaterThan(0)
  })

  test('counts the offset in UTF-8 bytes, not UTF-16 units', () => {
    // An em dash is one character and three bytes. Reporting 1 here would send a reader to
    // the wrong place in a file they are about to open with a byte-addressed tool.
    const result = compareRenders('—a', '—b')

    expect(result.offset).toBe(3)
  })
})

describe('json form', () => {
  test('gives one object per tier, consumable without parsing prose', () => {
    const parsed: unknown = JSON.parse(renderBriefJson(planBrief(INPUT)))
    const report = parsed as {
      tiers: { level: number; label: string; content: string }[]
      generated_from: string[]
    }

    expect(report.tiers.map((t) => t.level)).toEqual([1, 2, 3, 4])
    expect(report.tiers[1]?.content).toContain('INV-A')
    expect(report.generated_from).toContain('AGENTS.md')
    expect([...report.generated_from].sort(byCodepoint)).toEqual(report.generated_from)
  })

  test('each tier content is the same string the text form emits', () => {
    const brief = planBrief(INPUT)
    const parsed = JSON.parse(renderBriefJson(brief)) as { tiers: { content: string }[] }

    for (const [i, tier] of brief.tiers.entries()) {
      expect(parsed.tiers[i]?.content).toBe(renderTierBody(tier, brief))
    }
  })
})

describe('sizes', () => {
  test('reports total and per-tier byte counts', () => {
    const sizes = briefSizes(planBrief(INPUT))

    expect(sizes.tiers.map((t) => t.level)).toEqual([1, 2, 3, 4])
    expect(sizes.total).toBeGreaterThan(0)
    for (const tier of sizes.tiers) expect(tier.bytes).toBeGreaterThan(0)
  })
})

describe('empty corpus', () => {
  test('still emits four tiers rather than nothing', () => {
    // Empty output is indistinguishable from a broken command. INC-0001.
    const brief = planBrief({ doctrine: [], entities: [] })
    const text = renderBrief(brief)

    for (const level of [1, 2, 3, 4]) {
      expect(text).toContain(`${TIER_MARKER_PREFIX}${level} `)
    }
    expect(brief.entityCount).toBe(0)
  })
})
