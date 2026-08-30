/**
 * Residency: what a doctrine file costs, and the check that says so.
 *
 * The failure this guards is silent by construction. A pack that seeds fifteen technique
 * files without declaring `residency` leaves every anchor resolving, every document valid,
 * and `kb verify` reporting clean — while tier 1 of every cold start quietly triples. So the
 * test that matters here is the one where the gate must *speak*.
 */
import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { planBrief, doctrineIndexEntry } from './brief.js'
import { readBriefInput } from './brief-source.js'
import { checkResidentDoctrine } from './verify.js'
import { verify } from './verify.js'
import { residencyOf, parseResidency, type DoctrineSummary } from './doctrine.js'
import { loadDoctrine } from './loader.js'
import { defaultConfig, DEFAULT_MAX_RESIDENT_DOCTRINE_BYTES } from './config.js'

function fixture(docs: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'kb-residency-'))
  for (const [path, body] of Object.entries(docs)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return root
}

const BULK = 'x'.repeat(4000)

const INDEXED = `---
title: Idempotency and delivery semantics
residency: index
when:
  - a retry could apply the same effect twice
---

# Idempotency and delivery semantics

${BULK}
`

const RESIDENT = `---
title: Verification and Honesty
when:
  - work is about to be reported as complete
---

# Verification and Honesty

Report the command's actual output.
`

const CORPUS = {
  'anchoring.config.json': '{}',
  '.anchor/doctrine/idempotency.md': INDEXED,
  '.anchor/doctrine/verification.md': RESIDENT,
}

describe('residency parsing', () => {
  test('absent means brief, which is what every file written before this did', () => {
    expect(parseResidency(undefined)).toBe('brief')
    expect(residencyOf({ name: 'x.md', path: 'x.md' })).toBe('brief')
  })

  test('an unrecognised value falls back to brief rather than inventing a third mode', () => {
    expect(parseResidency('resident')).toBe('brief')
    expect(parseResidency(7)).toBe('brief')
  })

  test('index is read from frontmatter', () => {
    const docs = loadDoctrine(defaultConfig(fixture(CORPUS)))

    expect(docs.find((d) => d.name === 'idempotency.md')?.residency).toBe('index')
    expect(docs.find((d) => d.name === 'verification.md')?.residency).toBe('brief')
  })
})

describe('the brief pays for resident doctrine only', () => {
  test('an indexed file contributes its triggers, not its body', () => {
    const brief = planBrief(readBriefInput(defaultConfig(fixture(CORPUS))))
    const tier1 = brief.tiers.find((t) => t.level === 1)
    const indexed = tier1?.documents.find((d) => d.id === 'idempotency.md')

    expect(indexed?.body).not.toContain(BULK)
    expect(indexed?.body).toContain('a retry could apply the same effect twice')
    expect(indexed?.body).toContain('Indexed, not resident')
  })

  test('a resident file still contributes its whole body', () => {
    const brief = planBrief(readBriefInput(defaultConfig(fixture(CORPUS))))
    const tier1 = brief.tiers.find((t) => t.level === 1)

    expect(tier1?.documents.find((d) => d.id === 'verification.md')?.body).toContain(
      "Report the command's actual output.",
    )
  })

  /** The saving is the entire justification for the field; measure it, do not assert it. */
  test('indexing a 4KB file costs under 300 bytes in tier 1', () => {
    const brief = planBrief(readBriefInput(defaultConfig(fixture(CORPUS))))
    const indexed = brief.tiers[0]?.documents.find((d) => d.id === 'idempotency.md')

    expect(indexed?.body.length).toBeLessThan(300)
  })

  test('an index entry carries no count, date, or size, so tier 1 stays cacheable', () => {
    const entry = doctrineIndexEntry({
      name: 'x.md',
      path: '.anchor/doctrine/x.md',
      title: 'A technique',
      when: ['a queue is growing faster than it drains'],
    })

    expect(entry).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(entry).toContain('a queue is growing faster than it drains')
  })
})

describe('the budget speaks', () => {
  const doc = (name: string, bytes: number, residency?: 'brief' | 'index') => ({
    summary: { name, path: `.anchor/doctrine/${name}`, ...(residency ? { residency } : {}) } as DoctrineSummary,
    bytes,
  })

  /**
   * The case the check exists for: a pack seeds a corpus and forgets `residency`.
   * If this ever stops failing, the mechanism has gone silent on its own purpose.
   */
  test('warns when a seeded corpus lands resident by default', () => {
    const seeded = Array.from({ length: 15 }, (_, i) => doc(`systems-${i}.md`, 5000))
    const findings = checkResidentDoctrine(seeded, DEFAULT_MAX_RESIDENT_DOCTRINE_BYTES)

    expect(findings.length).toBe(1)
    expect(findings[0]?.message).toContain('75000 bytes in tier 1 (75000 of it whole bodies)')
    expect(findings[0]?.hint).toContain('residency: index')
  })

  test('the same corpus, indexed, costs its entries and not its bodies', () => {
    const seeded = Array.from({ length: 15 }, (_, i) => doc(`systems-${i}.md`, 5000, 'index'))

    expect(checkResidentDoctrine(seeded, DEFAULT_MAX_RESIDENT_DOCTRINE_BYTES)).toEqual([])
  })

  /**
   * The hole the first version of this check had: twenty correctly-indexed files still cost
   * 15 KB of tier 1, and counting bodies alone reported clean. A check that stays quiet on
   * the case it exists for is worse than none, because it also removes the suspicion.
   */
  test('an entirely indexed corpus large enough to matter is not silent', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      summary: {
        name: `t-${i}.md`,
        path: `.anchor/doctrine/t-${i}.md`,
        title: 'A technique with a reasonably descriptive title',
        residency: 'index',
        when: [
          'a situation that calls for this technique arises in the work',
          'a second trigger phrase that is also reasonably long',
        ],
      } as DoctrineSummary,
      bytes: 5000,
    }))
    const findings = checkResidentDoctrine(many, DEFAULT_MAX_RESIDENT_DOCTRINE_BYTES)

    expect(findings.length).toBe(1)
    expect(findings[0]?.message).toContain('0 of it whole bodies')
    expect(findings[0]?.hint).toContain('already indexed')
  })

  test('it names the heaviest files, so the fix has somewhere to start', () => {
    const findings = checkResidentDoctrine(
      [doc('small.md', 100), doc('huge.md', 20000), doc('medium.md', 9000)],
      16000,
    )

    expect(findings[0]?.message).toContain('huge.md (20000b)')
    expect(findings[0]?.message).toContain('medium.md (9000b)')
  })

  test('it is advisory, so --strict cannot turn a verbose corpus into a red build', () => {
    const findings = checkResidentDoctrine([doc('huge.md', 99999)], 16000)

    expect(findings[0]?.severity).toBe('warn')
    expect(findings[0]?.advisory).toBe(true)
  })

  test('a corpus inside the budget produces no finding at all', () => {
    expect(checkResidentDoctrine([doc('a.md', 5000)], 16000)).toEqual([])
  })

  test('end to end: verify reports the overrun on a real corpus on disk', () => {
    const root = fixture({
      'anchoring.config.json': '{}',
      '.anchor/doctrine/big.md': `# Big\n\n${BULK}\n`,
    })
    const report = verify({ ...defaultConfig(root), maxResidentDoctrineBytes: 1000 })
    const budget = report.findings.filter((f) => f.where.includes('brief tier 1'))

    expect(budget.length).toBe(1)
    expect(budget[0]?.advisory).toBe(true)
  })
})
