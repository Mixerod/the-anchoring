import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { verify, type Finding } from './verify.js'
import { defaultConfig } from './config.js'

/**
 * HAZ- is the one kind whose value comes entirely from its constraints. A hazard with no
 * source is a rumour; one that sits `open` forever is a worry nobody acted on; and an
 * unbounded catalogue of them is a graveyard. Each of those three is a test here, in both
 * directions — see ADR-0015 and W-58.
 */

interface Doc {
  readonly path: string
  readonly body: string
}

function fixture(...docs: readonly Doc[]): string {
  const root = mkdtempSync(join(tmpdir(), 'kb-hazard-'))
  for (const doc of docs) {
    const full = join(root, doc.path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, doc.body)
  }
  return root
}

const conf = (root: string) => defaultConfig(root)

const haz = (id: string, body: string): Doc => ({ path: `.anchor/hazard/${id}.md`, body })
const inv = (id: string, body: string): Doc => ({ path: `.anchor/invariant/${id}.md`, body })

const code: Doc = { path: 'src/thing.ts', body: 'export const x = 1\n' }
const INV_X = inv('INV-X', '---\nid: INV-X\ntitle: X holds\nstatus: active\n---\n')

/** The frontmatter every valid hazard shares, so each test states only its own variable. */
function hazard(
  id: string,
  extra: string,
  opts: { readonly recorded?: string; readonly holdsFor?: string } = {},
): Doc {
  const recorded = opts.recorded ?? '2026-08-23'
  const holdsFor = opts.holdsFor ?? 'file:src/thing.ts'
  return haz(
    id,
    `---\nid: ${id}\ntitle: A mechanism\nstatus: active\n` +
      `source: https://example.org/report\nobserved: 2013-03-11\nrecorded: ${recorded}\n` +
      `${extra}holds_for:\n  - ${holdsFor}\n---\n`,
  )
}

const NOW = new Date('2026-08-23T00:00:00Z')

const findings = (root: string, now: Date = NOW): readonly Finding[] => verify(conf(root), now).findings
const errors = (root: string, now: Date = NOW): readonly Finding[] =>
  findings(root, now).filter((f) => f.severity === 'error')
const warnings = (root: string, now: Date = NOW): readonly Finding[] =>
  findings(root, now).filter((f) => f.severity === 'warn')

describe('hazard schema', () => {
  test('accepts a well-formed open hazard', () => {
    const root = fixture(code, hazard('HAZ-0001', 'resolution: open\n'))

    expect(findings(root)).toEqual([])
    expect(verify(conf(root), NOW).entityCount).toBe(1)
  })

  test('accepts a guarded hazard that names an invariant that exists', () => {
    const root = fixture(
      code,
      INV_X,
      hazard('HAZ-0001', 'resolution: guarded\nresolves_to:\n  - INV-X\n'),
    )

    expect(findings(root)).toEqual([])
  })

  test('accepts an accepted hazard that gives a reason', () => {
    const root = fixture(code, hazard('HAZ-0001', 'resolution: accepted\nreason: the blast radius is one match\n'))

    expect(findings(root)).toEqual([])
  })

  test('accepts a not-applicable hazard with empty holds_for (e.g. untriaged pack seed)', () => {
    const root = fixture(
      code,
      haz(
        'HAZ-0001',
        '---\nid: HAZ-0001\ntitle: Untriaged\nstatus: active\nsource: https://example.org/report\n' +
          'observed: 2026-01-01\nrecorded: 2026-08-23\nresolution: not-applicable\n' +
          'reason: not yet triaged in this repository\nholds_for: []\n---\n',
      ),
    )

    expect(findings(root)).toEqual([])
  })
})

describe('source is mandatory', () => {
  test('fails a hazard with no source at all', () => {
    const root = fixture(
      code,
      haz(
        'HAZ-0001',
        '---\nid: HAZ-0001\ntitle: A mechanism\nstatus: active\nobserved: 2013-03-11\n' +
          'recorded: 2026-08-23\nresolution: open\nholds_for:\n  - file:src/thing.ts\n---\n',
      ),
    )
    const [finding] = errors(root)

    expect(finding?.message).toContain('source')
    expect(finding?.hint).toContain('rumour')
  })

  test('fails a source that is not a public URL', () => {
    const root = fixture(
      code,
      haz(
        'HAZ-0001',
        '---\nid: HAZ-0001\ntitle: A mechanism\nstatus: active\nsource: someone told me\n' +
          'observed: 2013-03-11\nrecorded: 2026-08-23\nresolution: open\n' +
          'holds_for:\n  - file:src/thing.ts\n---\n',
      ),
    )

    expect(errors(root)[0]?.message).toContain('must be an http(s) URL')
  })

  test('fails an observed date that is not YYYY-MM-DD', () => {
    const root = fixture(
      code,
      haz(
        'HAZ-0001',
        '---\nid: HAZ-0001\ntitle: A mechanism\nstatus: active\nsource: https://example.org/r\n' +
          'observed: sometime in 2013\nrecorded: 2026-08-23\nresolution: open\n' +
          'holds_for:\n  - file:src/thing.ts\n---\n',
      ),
    )

    expect(errors(root)[0]?.message).toContain('observed')
  })
})

describe('resolution is mandatory and consistent', () => {
  test('fails a hazard with no resolution', () => {
    const root = fixture(
      code,
      haz(
        'HAZ-0001',
        '---\nid: HAZ-0001\ntitle: A mechanism\nstatus: active\nsource: https://example.org/r\n' +
          'observed: 2013-03-11\nrecorded: 2026-08-23\nholds_for:\n  - file:src/thing.ts\n---\n',
      ),
    )

    expect(errors(root)[0]?.message).toContain('resolution')
  })

  test('fails a resolution outside the four allowed values', () => {
    const root = fixture(code, hazard('HAZ-0001', 'resolution: probably-fine\n'))

    expect(errors(root)[0]?.message).toContain('guarded, accepted, not-applicable, open')
  })

  test('fails guarded with no resolves_to — a guard nobody can find is not a guard', () => {
    const root = fixture(code, hazard('HAZ-0001', 'resolution: guarded\n'))
    const [finding] = errors(root)

    expect(finding?.message).toContain('guarded')
    expect(finding?.hint).toContain('resolves_to')
  })

  test('fails resolves_to on a hazard that is not guarded', () => {
    const root = fixture(code, INV_X, hazard('HAZ-0001', 'resolution: open\nresolves_to:\n  - INV-X\n'))

    expect(errors(root)[0]?.message).toContain('only `guarded`')
  })

  test('fails resolves_to pointing at an invariant that does not exist', () => {
    const root = fixture(code, hazard('HAZ-0001', 'resolution: guarded\nresolves_to:\n  - INV-GHOST\n'))

    expect(errors(root).some((f) => f.message.includes('INV-GHOST'))).toBe(true)
  })

  test('fails accepted with no reason', () => {
    const root = fixture(code, hazard('HAZ-0001', 'resolution: accepted\n'))

    expect(errors(root)[0]?.message).toContain('reason')
  })

  test('fails not-applicable with no reason', () => {
    const root = fixture(code, hazard('HAZ-0001', 'resolution: not-applicable\n'))

    expect(errors(root)[0]?.message).toContain('reason')
  })
})

describe('the 30-day clock on open', () => {
  test('an open hazard recorded today is clean', () => {
    const root = fixture(code, hazard('HAZ-0001', 'resolution: open\n', { recorded: '2026-08-23' }))

    expect(findings(root)).toEqual([])
  })

  test('an open hazard 30 days old is still clean — the boundary is not off by one', () => {
    const root = fixture(code, hazard('HAZ-0001', 'resolution: open\n', { recorded: '2026-07-24' }))

    expect(findings(root)).toEqual([])
  })

  test('an open hazard 31 days old warns, so --strict fails it', () => {
    const root = fixture(code, hazard('HAZ-0001', 'resolution: open\n', { recorded: '2026-07-23' }))

    expect(errors(root)).toEqual([])
    expect(warnings(root)[0]?.message).toContain('open for 31 days')
    expect(warnings(root)[0]?.hint).toContain('INV-')
  })

  test('the clock runs only on open — a resolved hazard may be as old as it likes', () => {
    const root = fixture(
      code,
      hazard('HAZ-0001', 'resolution: accepted\nreason: understood\n', { recorded: '2020-01-01' }),
    )

    expect(findings(root)).toEqual([])
  })

  test('a retired hazard is not chased', () => {
    const root = fixture(code, {
      path: '.anchor/hazard/HAZ-0001.md',
      body:
        '---\nid: HAZ-0001\ntitle: A mechanism\nstatus: retired\nsource: https://example.org/r\n' +
        'observed: 2013-03-11\nrecorded: 2020-01-01\nresolution: open\n' +
        'holds_for:\n  - file:src/thing.ts\n---\n',
    })

    expect(findings(root)).toEqual([])
  })
})

describe('holds_for is what makes a hazard reachable', () => {
  test('fails a hazard with no holds_for — nothing could ever surface it', () => {
    const root = fixture(
      code,
      haz(
        'HAZ-0001',
        '---\nid: HAZ-0001\ntitle: A mechanism\nstatus: active\nsource: https://example.org/r\n' +
          'observed: 2013-03-11\nrecorded: 2026-08-23\nresolution: open\n---\n',
      ),
    )
    const [finding] = errors(root)

    expect(finding?.where).toContain('holds_for')
    expect(finding?.hint).toContain('anchor intersection')
  })

  test('fails a sym: anchor — it cannot be verified until codegraph is indexed', () => {
    const root = fixture(code, hazard('HAZ-0001', 'resolution: open\n', { holdsFor: 'sym:calculateCost' }))

    expect(errors(root).some((f) => f.message.includes('file:'))).toBe(true)
  })
})

describe('the ceiling of 24', () => {
  const many = (n: number): readonly Doc[] =>
    Array.from({ length: n }, (_, i) =>
      hazard(`HAZ-${String(i + 1).padStart(4, '0')}`, 'resolution: open\n'),
    )

  test('24 active hazards is allowed', () => {
    const root = fixture(code, ...many(24))

    expect(errors(root)).toEqual([])
  })

  test('25 active hazards fails, and the fix is to promote one to an invariant', () => {
    const root = fixture(code, ...many(25))
    const [finding] = errors(root)

    expect(finding?.message).toContain('25 active hazards')
    expect(finding?.hint).toContain('INV-')
  })

  test('retired hazards do not count toward the ceiling', () => {
    const retired: Doc = {
      path: '.anchor/hazard/HAZ-9999.md',
      body:
        '---\nid: HAZ-9999\ntitle: Old\nstatus: retired\nsource: https://example.org/r\n' +
        'observed: 2013-03-11\nrecorded: 2026-08-23\nresolution: open\n' +
        'holds_for:\n  - file:src/thing.ts\n---\n',
    }
    const root = fixture(code, ...many(24), retired)

    expect(errors(root)).toEqual([])
  })
})
