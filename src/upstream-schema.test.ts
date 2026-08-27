/**
 * The upstream-attribution schema, checked one rule at a time.
 *
 * The tests that matter most here are the negative ones: `local` requires nothing, an
 * absent verdict is silent, and 59 days does not warn. A gate that speaks on everything is
 * a gate that gets switched off, and a classifier that can never say `no` reports noise.
 */
import { describe, expect, test } from 'vitest'
import { checkUpstream, checkUpstreamCeiling } from './verify-upstream.js'
import { defaultConfig } from './config.js'
import { EVIDENCE_CLASSES, UPSTREAM_CEILING, UPSTREAM_OPEN_DAYS } from './model.js'
import { buildStore, type Entity } from './store.js'

const CONFIG = defaultConfig('/repo')
const NOW = new Date('2026-08-28T00:00:00Z')

function incident(
  fields: Readonly<Record<string, string>>,
  links: Readonly<Record<string, readonly string[]>> = {},
  id = 'INC-0007',
): Entity {
  return {
    id,
    kind: 'INC',
    title: 'Something broke',
    status: 'open',
    path: `.anchor/incident/${id}.md`,
    links,
    fields,
  }
}

const check = (e: Entity, now: Date = NOW) => checkUpstream(e, CONFIG, now)
const messages = (e: Entity, now: Date = NOW) => check(e, now).map((f) => f.message)

describe('the default verdict is local', () => {
  test('an absent verdict is silent and requires nothing', () => {
    expect(check(incident({}))).toEqual([])
  })

  test('an explicit `local` requires nothing either — not even a package name', () => {
    expect(check(incident({ upstream_verdict: 'local' }))).toEqual([])
  })

  test('a non-incident is never checked at all', () => {
    const adr: Entity = {
      id: 'ADR-0001',
      kind: 'ADR',
      title: 'A',
      status: 'accepted',
      path: 'docs/adr/ADR-0001.md',
      links: {},
      fields: { upstream_verdict: 'nonsense' },
    }
    expect(checkUpstream(adr, CONFIG, NOW)).toEqual([])
  })
})

describe('the verdict itself', () => {
  test('a value outside the three is an error listing all three', () => {
    const found = check(incident({ upstream_verdict: 'theirs' }))
    expect(found.length).toBe(1)
    expect(found[0]?.severity).toBe('error')
    expect(found[0]?.message).toContain('local, upstream, unclear')
  })
})

describe('the package name', () => {
  test('verdict `upstream` with no package name is an error', () => {
    expect(messages(incident({ upstream_verdict: 'upstream' }))).toContain(
      'verdict is `upstream` but no package is named',
    )
  })

  test('verdict `unclear` with no package name is an error too', () => {
    expect(messages(incident({ upstream_verdict: 'unclear' }))).toContain(
      'verdict is `unclear` but no package is named',
    )
  })

  test('`unclear` with a package name is complete — it demands no evidence class', () => {
    expect(check(incident({ upstream_verdict: 'unclear', upstream: 'the-anchoring' }))).toEqual([])
  })
})

describe('the evidence class', () => {
  const base = {
    upstream_verdict: 'upstream',
    upstream: 'the-anchoring',
    upstream_recorded: '2026-08-27',
  }

  test('verdict `upstream` with no evidence class is an error', () => {
    expect(messages(incident(base))).toContain('verdict is `upstream` but names no evidence class')
  })

  test('a class outside the four is an error listing the four', () => {
    const found = messages(incident({ ...base, upstream_evidence: 'vibes' }))
    expect(found.some((m) => m.includes(EVIDENCE_CLASSES.join(', ')))).toBe(true)
  })

  test('silent-gate must name one of the four gates', () => {
    expect(messages(incident({ ...base, upstream_evidence: 'silent-gate' }))).toContain(
      'silent-gate must name the gate that stayed silent, and gives none',
    )
    expect(
      messages(incident({ ...base, upstream_evidence: 'silent-gate', upstream_gate: 'lint' })),
    ).toContain('silent-gate must name the gate that stayed silent, not `lint`')
    expect(
      check(incident({ ...base, upstream_evidence: 'silent-gate', upstream_gate: 'done' })),
    ).toEqual([])
  })

  test('generated-artifact must anchor a file the tool generated', () => {
    expect(
      messages(
        incident(
          { ...base, upstream_evidence: 'generated-artifact' },
          { touches: ['file:src/app.ts'] },
        ),
      ),
    ).toContain('generated-artifact names no anchor in a file the tool generated')

    for (const anchor of [
      'file:.anchor/work/W-1.md',
      'file:anchoring.guards.mjs',
      'file:anchoring.config.json',
    ]) {
      expect(
        check(incident({ ...base, upstream_evidence: 'generated-artifact' }, { touches: [anchor] })),
        anchor,
      ).toEqual([])
    }
  })

  test('shipped-invariant must name one of the five shipped invariants', () => {
    expect(
      messages(
        incident({ ...base, upstream_evidence: 'shipped-invariant' }, { violates: ['INV-OUR-OWN'] }),
      ),
    ).toContain('shipped-invariant names none of the shipped invariants')

    expect(
      check(
        incident(
          { ...base, upstream_evidence: 'shipped-invariant' },
          { violates: ['INV-PURE-CORE'] },
        ),
      ),
    ).toEqual([])
  })

  test('schema-gap must carry the frontmatter snippet the validator refused', () => {
    expect(messages(incident({ ...base, upstream_evidence: 'schema-gap' }))).toContain(
      'schema-gap carries no rejected frontmatter snippet',
    )
    expect(
      messages(incident({ ...base, upstream_evidence: 'schema-gap', upstream_rejected: '   ' })),
    ).toContain('schema-gap carries no rejected frontmatter snippet')
    expect(
      check(
        incident({ ...base, upstream_evidence: 'schema-gap', upstream_rejected: 'owner: claude' }),
      ),
    ).toEqual([])
  })
})

describe('the date and the clock', () => {
  const base = {
    upstream_verdict: 'upstream',
    upstream: 'the-anchoring',
    upstream_evidence: 'silent-gate',
    upstream_gate: 'verify',
  }

  const daysAgo = (n: number): string =>
    new Date(NOW.getTime() - n * 86_400_000).toISOString().slice(0, 10)

  test('verdict `upstream` with no recorded date is an error', () => {
    expect(messages(incident(base))).toContain('must be a YYYY-MM-DD date, and is missing')
  })

  test('a malformed date is an error naming the value', () => {
    expect(messages(incident({ ...base, upstream_recorded: 'last tuesday' }))).toContain(
      'must be a YYYY-MM-DD date, not `last tuesday`',
    )
  })

  test('does not warn one day inside the limit', () => {
    expect(check(incident({ ...base, upstream_recorded: daysAgo(UPSTREAM_OPEN_DAYS - 1) }))).toEqual(
      [],
    )
  })

  test('warns one day past the limit, with no work item opened', () => {
    const found = check(incident({ ...base, upstream_recorded: daysAgo(UPSTREAM_OPEN_DAYS + 1) }))
    expect(found.length).toBe(1)
    expect(found[0]?.severity).toBe('warn')
    expect(found[0]?.message).toContain(`escalated ${UPSTREAM_OPEN_DAYS + 1} days ago`)
  })

  test('an open work item silences the clock however old the escalation is', () => {
    expect(
      check(incident({ ...base, upstream_recorded: '2020-01-01', upstream_work: 'W-13' })),
    ).toEqual([])
  })
})

describe('the ceiling', () => {
  function storeOf(count: number, withWork = false) {
    return buildStore(
      Array.from({ length: count }, (_, i) =>
        incident(
          {
            upstream_verdict: 'upstream',
            upstream: 'the-anchoring',
            upstream_evidence: 'silent-gate',
            upstream_gate: 'verify',
            upstream_recorded: '2026-08-27',
            ...(withWork ? { upstream_work: `W-${i + 1}` } : {}),
          },
          {},
          `INC-${String(i + 1).padStart(4, '0')}`,
        ),
      ),
    )
  }

  test('does not error at the ceiling', () => {
    expect(checkUpstreamCeiling(storeOf(UPSTREAM_CEILING))).toEqual([])
  })

  test('errors one past the ceiling', () => {
    const found = checkUpstreamCeiling(storeOf(UPSTREAM_CEILING + 1))
    expect(found.length).toBe(1)
    expect(found[0]?.severity).toBe('error')
    expect(found[0]?.message).toContain(`${UPSTREAM_CEILING + 1} incidents escalated upstream`)
  })

  test('incidents with a work item do not count toward the ceiling', () => {
    expect(checkUpstreamCeiling(storeOf(UPSTREAM_CEILING * 3, true))).toEqual([])
  })
})
