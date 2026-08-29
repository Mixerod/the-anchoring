import { describe, expect, test } from 'vitest'
import { planBrief, type BriefEntity, type BriefInput } from './brief.js'
import { corpusStats, renderStats, BYTES_PER_TOKEN_ESTIMATE } from './render-stats.js'
import type { Entity } from './store.js'
import type { EntityKind } from './model.js'

const doc = (id: string, kind: EntityKind, status: string, body: string): BriefEntity => ({
  entity: {
    id,
    kind,
    title: `${id} title`,
    status,
    path: `.anchor/${kind.toLowerCase()}/${id}.md`,
    links: {},
    fields: {},
  } satisfies Entity,
  body,
})

const INPUT: BriefInput = {
  agents: { name: 'AGENTS.md', path: 'AGENTS.md', body: 'a'.repeat(100) },
  doctrine: [{ name: 'solid.md', path: '.anchor/doctrine/solid.md', body: 'd'.repeat(200) }],
  entities: [
    doc('INV-A', 'INV', 'active', 'i'.repeat(300)),
    doc('ADR-0001', 'ADR', 'accepted', 'r'.repeat(400)),
    doc('INC-0001', 'INC', 'fixed', 'n'.repeat(500)),
    doc('W-1', 'WORK', 'done', 'w'.repeat(600)),
  ],
}

const stats = () => corpusStats(planBrief(INPUT), INPUT)

describe('corpusStats', () => {
  test('counts every document, bundled or not', () => {
    // 100 + 200 + 300 + 400 + 500 + 600
    expect(stats().totalBytes).toBe(2100)
  })

  test('separates doctrine and agent files from entities', () => {
    expect(stats().fileBytes).toBe(300)
    expect(stats().fileCount).toBe(2)
  })

  test('counts what the brief leaves out, and names it', () => {
    // The incident and the closed work item: real corpus, absent from the bundle. Reporting
    // only the bundled part under the word "corpus" would understate the repository.
    const s = stats()

    expect(s.excludedCount).toBe(2)
    expect(s.excludedBytes).toBe(1100)
    expect(s.briefBytes).toBeLessThan(s.totalBytes)
  })

  test('breaks entity bytes down by kind', () => {
    const byKind = Object.fromEntries(stats().kinds.map((k) => [k.kind, k.bytes]))

    expect(byKind['INV']).toBe(300)
    expect(byKind['ADR']).toBe(400)
    expect(byKind['INC']).toBe(500)
    expect(byKind['WORK']).toBe(600)
    expect(byKind['FLOW']).toBe(0)
  })

  test('reports bytes per tier', () => {
    expect(stats().tiers.map((t) => t.level)).toEqual([1, 2, 3, 4])
  })

  test('corpus equals brief plus what the brief leaves out', () => {
    // The arithmetic a reader will do in their head, so it has to hold. Counting the brief's
    // own markers as brief content broke it: on a small corpus the brief came out *larger*
    // than everything while reporting nothing excluded - correct arithmetic that reads as
    // nonsense, which is worse than a wrong number because it looks like a lie.
    const s = stats()

    expect(s.briefBytes + s.excludedBytes).toBe(s.totalBytes)
  })

  test('markers are counted apart from document content', () => {
    const s = stats()

    expect(s.frameBytes).toBeGreaterThan(0)
    expect(s.briefBytes).not.toBe(0)
  })

  test('doctrine and AGENTS.md count as bundled, because tier 1 carries them', () => {
    const s = stats()

    expect(s.briefBytes).toBeGreaterThanOrEqual(s.fileBytes)
  })
})

describe('renderStats — the honesty requirement', () => {
  const out = () => renderStats(stats())

  test('states bytes as the measured number', () => {
    expect(out()).toContain('2,100 bytes')
  })

  test('labels the token figure an estimate and states its divisor', () => {
    // This tool calls no tokenizer. A confident token count derived from nothing would be
    // indistinguishable from a real one.
    const text = out()

    expect(text).toContain('estimate')
    expect(text).toContain(`bytes/${BYTES_PER_TOKEN_ESTIMATE}`)
    expect(text).toContain('runs no tokenizer')
  })

  test('never claims to have measured tokens', () => {
    expect(out()).not.toMatch(/^\s*tokens: \d/m)
  })

  test('names what is missing from the brief', () => {
    expect(out()).toContain('not in the brief')
    expect(out()).toContain('incidents, retired, superseded, closed work')
  })
})
