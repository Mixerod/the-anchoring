import { describe, expect, test } from 'vitest'
import { PLAIN, renderCtx, renderDone, renderVerify, renderWhy } from './render.js'
import type { VerifyReport } from './verify.js'
import type { WhyReport } from './why.js'

const entity = {
  id: 'ADR-0003',
  kind: 'ADR' as const,
  title: 'Tempo Pool',
  status: 'accepted',
  path: 'docs/adr/0003-tempo.md',
  links: {},
  fields: {},
}

const report = (over: Partial<VerifyReport> = {}): VerifyReport => ({
  findings: [],
  entityCount: 15,
  anchorCount: 29,
  indexed: true,
  ...over,
})

describe('renderVerify', () => {
  test('reports a clean run with the corpus size', () => {
    expect(renderVerify(report(), PLAIN)).toBe('kb verify: clean (15 entities, 29 anchors)')
  })

  test('prints errors before warnings, so the blocking problem is read first', () => {
    const text = renderVerify(
      report({
        findings: [
          { severity: 'warn', where: 'ADR-0001', message: 'second' },
          { severity: 'error', where: 'ADR-0002', message: 'first' },
        ],
      }),
      PLAIN,
    )

    expect(text.indexOf('first')).toBeLessThan(text.indexOf('second'))
    expect(text).toContain('1 error(s), 1 warning(s)')
  })

  test('shows the hint when a finding carries one', () => {
    const text = renderVerify(
      report({
        findings: [{ severity: 'error', where: 'ADR-0001', message: 'broken', hint: 'do this' }],
      }),
      PLAIN,
    )

    expect(text).toContain('-> do this')
  })

  test('says how to make symbol anchors checkable when some went unchecked', () => {
    const text = renderVerify(
      report({
        indexed: false,
        findings: [{ severity: 'warn', where: 'ADR-0003', message: 'sym:calculateCost unverifiable' }],
      }),
      PLAIN,
    )

    expect(text).toContain('1 symbol anchor(s) unverified')
    expect(text).toContain('codegraph init')
  })

  test('stays quiet about the index when nothing actually went unchecked', () => {
    // An unindexed repo whose anchors are all file:-form checked everything it claimed.
    // Saying otherwise trains the reader to skip the last line.
    expect(renderVerify(report({ indexed: false }), PLAIN)).not.toContain('codegraph')
  })

  test('says nothing about indexing once the repo is indexed', () => {
    expect(renderVerify(report(), PLAIN)).not.toContain('codegraph')
  })
})

describe('renderWhy', () => {
  const base: WhyReport = { query: 'x', mentions: [], outgoing: [], incoming: [] }

  test('renders an entity with both link directions', () => {
    const text = renderWhy(
      {
        ...base,
        query: 'ADR-0003',
        subject: entity,
        outgoing: [{ field: 'constrains', target: { ...entity, id: 'INV-TEMPO-BITES' } }],
        incoming: [{ field: 'decided_by', source: { ...entity, id: 'FLOW-0001' } }],
      },
      PLAIN,
    )

    expect(text).toContain('constrains   -> INV-TEMPO-BITES')
    expect(text).toContain('<- FLOW-0001 decided_by')
  })

  test('says so plainly when an entity has no links yet', () => {
    expect(renderWhy({ ...base, query: 'ADR-0003', subject: entity }, PLAIN)).toContain(
      'no links yet',
    )
  })

  test('renders each code mention with its relationship and source document', () => {
    const text = renderWhy(
      {
        ...base,
        query: 'src/costs.ts',
        mentions: [
          {
            entity,
            field: 'governs',
            phrase: 'is governed by',
            matched: 'file:src/costs.ts',
          },
        ],
      },
      PLAIN,
    )

    expect(text).toContain('ADR-0003   is governed by')
    expect(text).toContain('Tempo Pool (accepted, docs/adr/0003-tempo.md)')
  })

  test('treats unclaimed code as a finding rather than an empty result', () => {
    const text = renderWhy({ ...base, query: 'packages/sim/src/rng.ts' }, PLAIN)

    expect(text).toContain('Nothing in the knowledge base refers to')
    expect(text).toContain('code with no recorded purpose')
  })
})

describe('renderCtx', () => {
  const base = { query: 'W-112', sections: [], anchors: [] }

  test('tells the agent what to create when the work item does not exist', () => {
    const text = renderCtx({ ...base, query: 'W-404' }, PLAIN)

    expect(text).toContain('.anchor/work/W-404.md')
  })

  test('renders a section entry with its title, path, and the link it came through', () => {
    const text = renderCtx(
      {
        ...base,
        subject: { ...entity, id: 'W-112', kind: 'WORK', title: 'Tune knight leap cost' },
        sections: [
          {
            heading: 'Decides this work',
            emptyNote: 'none',
            entries: [
              { id: 'ADR-0003', title: 'Tempo Pool', path: 'docs/adr/0003.md', via: 'implements' },
            ],
          },
        ],
      },
      PLAIN,
    )

    expect(text).toContain('ADR-0003')
    expect(text).toContain('Tempo Pool')
    expect(text).toContain('docs/adr/0003.md - implements')
  })

  test('prints the empty note rather than an empty heading', () => {
    const text = renderCtx(
      {
        ...base,
        subject: entity,
        sections: [{ heading: 'Closes', emptyNote: 'no incident', entries: [] }],
      },
      PLAIN,
    )

    expect(text).toContain('no incident')
  })

  test('lists anchors, and points at codegraph when indexed', () => {
    const text = renderCtx(
      { ...base, subject: entity, anchors: ['file:src/costs.ts'], indexed: true },
      PLAIN,
    )

    expect(text).toContain('file:src/costs.ts')
    expect(text).toContain('codegraph explore')
  })

  test('prints only "Read only what applies." when not indexed', () => {
    const text = renderCtx(
      { ...base, subject: entity, anchors: ['file:src/costs.ts'], indexed: false },
      PLAIN,
    )

    expect(text).toContain('file:src/costs.ts')
    expect(text).toContain('Read only what applies.')
    expect(text).not.toContain('codegraph explore')
  })

  test('says so when nothing is anchored yet', () => {
    expect(renderCtx({ ...base, subject: entity }, PLAIN)).toContain('nothing anchored yet')
  })
})

describe('renderDone', () => {
  const work = { ...entity, id: 'W-112', kind: 'WORK' as const, title: 'Tune knight leap cost' }

  test('confirms plainly when nothing is left to record', () => {
    const text = renderDone({ work, workId: 'W-112', changed: ['a.ts'], gaps: [], upstreamNotices: [] }, PLAIN)

    expect(text).toContain('fully recorded')
    expect(text).toContain('1 file(s) changed')
  })

  test('prints each gap with the exact fix', () => {
    const text = renderDone(
      {
        work,
        workId: 'W-112',
        changed: ['a.ts'],
        upstreamNotices: [],
        gaps: [
          { kind: 'unlinked-decision', message: 'a.ts is governed by ADR-0008', fix: 'add implements' },
        ],
      },
      PLAIN,
    )

    expect(text).toContain('not closed yet')
    expect(text).toContain('a.ts is governed by ADR-0008')
    expect(text).toContain('-> add implements')
  })

  test('falls back to the raw id when the work item was not found', () => {
    const text = renderDone(
      {
        workId: 'W-404',
        changed: [],
        upstreamNotices: [],
        gaps: [{ kind: 'status', message: 'no work item `W-404`', fix: 'create it' }],
      },
      PLAIN,
    )

    expect(text).toContain('W-404')
  })
})

describe('renderDone surfaces open upstream loops', () => {
  const work = { ...entity, id: 'W-112', kind: 'WORK' as const, title: 'Tune knight leap cost' }

  test('appends one yellow line per open loop, even when nothing is left to record', () => {
    const text = renderDone(
      {
        work,
        workId: 'W-112',
        changed: ['a.ts'],
        gaps: [],
        upstreamNotices: ['INC-0007 is escalated upstream with no work item opened'],
      },
      PLAIN,
    )

    expect(text).toContain('fully recorded')
    expect(text).toContain('kb upstream: INC-0007 is escalated upstream with no work item opened')
  })

  test('says nothing when there is no open loop', () => {
    const text = renderDone(
      { work, workId: 'W-112', changed: [], gaps: [], upstreamNotices: [] },
      PLAIN,
    )
    expect(text).not.toContain('kb upstream')
  })
})
