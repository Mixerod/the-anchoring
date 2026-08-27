/**
 * `kb upstream`, end to end.
 *
 * The assertions that carry the most weight are the ones about what a report *does not*
 * contain — no absolute path, no file content — and the ones about the negative path:
 * `local` and `unclear` produce no report but still appear in `--list`.
 */
import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  UPSTREAM_BANNER,
  checkUpstream,
  listUpstream,
  openLoopNotices,
  planUpstream,
  upstreamHash,
  type PackageFacts,
} from './upstream.js'
import { buildStore, type Entity } from './store.js'
import { defaultConfig } from './config.js'
import { loadStore } from './loader.js'
import { loadConfig } from './root.js'
import { run } from './cli.js'

const PKG: PackageFacts = { name: 'the-anchoring', version: '0.1.2' }
const CONFIG = defaultConfig('/repo')

function incident(
  id: string,
  fields: Readonly<Record<string, string>>,
  links: Readonly<Record<string, readonly string[]>> = {},
): Entity {
  return {
    id,
    kind: 'INC',
    title: `Incident ${id}`,
    status: 'open',
    path: `.anchor/incident/${id}.md`,
    links,
    fields,
  }
}

const escalatedFields = (evidence: string, extra: Record<string, string> = {}) => ({
  upstream_verdict: 'upstream',
  upstream: 'the-anchoring',
  upstream_evidence: evidence,
  upstream_recorded: '2026-08-28',
  ...extra,
})

function makeTemp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function invokeCli(argv: readonly string[], root: string) {
  const out: string[] = []
  const err: string[] = []
  const code = run([...argv, '--no-colour'], (t) => out.push(t), (t) => err.push(t), root)
  return { code, out: out.join('\n'), err: err.join('\n') }
}

describe('one report per evidence class', () => {
  const cases = [
    ['silent-gate', escalatedFields('silent-gate', { upstream_gate: 'done' }), {}],
    ['generated-artifact', escalatedFields('generated-artifact'), { touches: ['file:anchoring.guards.mjs'] }],
    ['shipped-invariant', escalatedFields('shipped-invariant'), { violates: ['INV-PURE-CORE'] }],
    ['schema-gap', escalatedFields('schema-gap', { upstream_rejected: 'owner: claude' }), {}],
  ] as const

  for (const [name, fields, links] of cases) {
    test(`${name} produces exactly one report`, () => {
      const store = buildStore([incident('INC-0001', fields, links)])
      const plan = planUpstream(CONFIG, store, PKG)

      expect(plan.reports.length).toBe(1)
      expect(plan.reports[0]?.about).toBe('INC-0001')
      expect(plan.reports[0]?.id).toBe('UP-0001')
      expect(plan.reports[0]?.path).toBe('.anchor/upstream/UP-0001.md')
      expect(plan.reports[0]?.body).toContain(`evidence: ${name}`)
    })
  }

  test('schema-gap carries the refused frontmatter snippet verbatim', () => {
    const store = buildStore([
      incident('INC-0001', escalatedFields('schema-gap', { upstream_rejected: 'owner: claude' })),
    ])
    const body = planUpstream(CONFIG, store, PKG).reports[0]?.body ?? ''
    expect(body).toContain('The frontmatter the validator refused')
    expect(body).toContain('owner: claude')
  })

  test('silent-gate names the gate that stayed silent', () => {
    const store = buildStore([
      incident('INC-0001', escalatedFields('silent-gate', { upstream_gate: 'done' })),
    ])
    const body = planUpstream(CONFIG, store, PKG).reports[0]?.body ?? ''
    expect(body).toContain('The gate that stayed silent: kb done')
  })
})

describe('what is not escalated', () => {
  test('no report for `local` or `unclear`', () => {
    const store = buildStore([
      incident('INC-0001', { upstream_verdict: 'local' }),
      incident('INC-0002', { upstream_verdict: 'unclear', upstream: 'the-anchoring' }),
      incident('INC-0003', {}),
    ])
    const plan = planUpstream(CONFIG, store, PKG)

    expect(plan.reports).toEqual([])
    expect(plan.notes).toContain('no incident sits at verdict `upstream`; nothing to report')
  })

  test('`--list` shows the local and unclear rows, with the reason each was not escalated', () => {
    const store = buildStore([
      incident('INC-0001', { upstream_verdict: 'local' }),
      incident('INC-0002', { upstream_verdict: 'unclear', upstream: 'the-anchoring' }),
      incident('INC-0003', escalatedFields('silent-gate', { upstream_gate: 'verify' })),
      incident('INC-0004', escalatedFields('silent-gate', { upstream_gate: 'verify', upstream_work: 'W-9' })),
    ])
    const rows = listUpstream(store)

    expect(rows.map((r) => r.id)).toEqual(['INC-0001', 'INC-0002', 'INC-0003', 'INC-0004'])
    expect(rows[0]?.reason).toContain('not escalated')
    expect(rows[1]?.reason).toContain('no evidence class applies')
    expect(rows[2]?.reason).toBe('escalated, no work item opened')
    expect(rows[3]?.reason).toBe('escalated, work item W-9')
  })

  test('an incident with no verdict at all still appears, as `local`', () => {
    const rows = listUpstream(buildStore([incident('INC-0001', {})]))
    expect(rows[0]?.verdict).toBe('local')
  })
})

describe('id allocation', () => {
  const fields = escalatedFields('silent-gate', { upstream_gate: 'verify' })

  test('allocates sequentially', () => {
    const store = buildStore([
      incident('INC-0001', fields),
      incident('INC-0002', fields),
      incident('INC-0003', fields),
    ])
    expect(planUpstream(CONFIG, store, PKG).reports.map((r) => r.id)).toEqual([
      'UP-0001',
      'UP-0002',
      'UP-0003',
    ])
  })

  test('an incident that already has a report keeps its id', () => {
    const store = buildStore([incident('INC-0001', fields), incident('INC-0002', fields)])
    const plan = planUpstream(CONFIG, store, PKG, [{ id: 'UP-0007', about: 'INC-0002' }])
    expect(plan.reports.map((r) => [r.about, r.id])).toEqual([
      ['INC-0001', 'UP-0001'],
      ['INC-0002', 'UP-0007'],
    ])
  })

  test('allocation skips an id another report already holds', () => {
    const store = buildStore([incident('INC-0002', fields)])
    const plan = planUpstream(CONFIG, store, PKG, [
      { id: 'UP-0001', about: 'INC-0009' },
      { id: 'UP-0002', about: 'INC-0008' },
    ])
    expect(plan.reports.map((r) => r.id)).toEqual(['UP-0003'])
  })
})

describe('what a report may contain, and what it may never', () => {
  const store = buildStore([
    incident('INC-0001', escalatedFields('generated-artifact'), {
      touches: ['file:packages/core/src/rules.ts', 'file:anchoring.guards.mjs'],
    }),
  ])
  const body = planUpstream(CONFIG, store, PKG).reports[0]?.body ?? ''

  test('carries the banner', () => {
    expect(body).toContain(UPSTREAM_BANNER)
  })

  test('carries the package name and version', () => {
    expect(body).toContain('package: the-anchoring')
    expect(body).toContain('package_version: 0.1.2')
  })

  test('carries the touched anchors as paths', () => {
    expect(body).toContain('packages/core/src/rules.ts')
    expect(body).not.toContain('file:packages/core/src/rules.ts')
  })

  test('contains no absolute path, Windows or POSIX', () => {
    expect(body).not.toMatch(/[A-Za-z]:\\/)
    for (const line of body.split('\n')) {
      expect(line.trimStart().startsWith('/'), line).toBe(false)
    }
  })

  test('ends with a ready-to-paste prompt telling the agent to reproduce first', () => {
    expect(body).toContain('For an upstream agent')
    expect(body).toContain('Reproduce it before fixing it.')
    expect(body).toContain('A fix with no failing case first is a guess.')
  })
})

describe('upstreamHash', () => {
  const store = buildStore([
    incident('INC-0001', escalatedFields('silent-gate', { upstream_gate: 'verify' })),
  ])
  const body = planUpstream(CONFIG, store, PKG).reports[0]?.body ?? ''

  test('ignores a changed status — that field is the human’s', () => {
    expect(upstreamHash(body.replace('status: draft', 'status: sent'))).toBe(upstreamHash(body))
    expect(upstreamHash(body.replace('status: draft', 'status: accepted'))).toBe(upstreamHash(body))
  })

  test('ignores anything appended under `## Notes`', () => {
    expect(upstreamHash(`${body}\nSent it on 2026-09-01. They accepted.\n`)).toBe(upstreamHash(body))
  })

  test('changes when any other line changes', () => {
    expect(upstreamHash(body.replace('package_version: 0.1.2', 'package_version: 9.9.9'))).not.toBe(
      upstreamHash(body),
    )
    expect(upstreamHash(body.replace('about: INC-0001', 'about: INC-0002'))).not.toBe(
      upstreamHash(body),
    )
  })
})

describe('checkUpstream returns each of the four states', () => {
  const store = buildStore([
    incident('INC-0001', escalatedFields('silent-gate', { upstream_gate: 'verify' })),
  ])
  const plan = planUpstream(CONFIG, store, PKG)
  const path = plan.reports[0]?.path ?? ''
  const body = plan.reports[0]?.body ?? ''
  const state = (content?: string) => checkUpstream(plan, () => content)[0]?.state

  test('missing', () => {
    expect(state(undefined)).toBe('missing')
  })

  test('ok, byte-identical', () => {
    expect(state(body)).toBe('ok')
    expect(path).toBe('.anchor/upstream/UP-0001.md')
  })

  test('ok, status changed and notes appended', () => {
    expect(state(`${body.replace('status: draft', 'status: sent')}\nCarried it upstream.\n`)).toBe('ok')
  })

  test('hand-edited when the body no longer matches its own hash', () => {
    expect(state(body.replace('package: the-anchoring', 'package: something-else'))).toBe(
      'hand-edited',
    )
  })

  test('stale when the file is self-consistent but built from older facts', () => {
    const older = planUpstream(CONFIG, store, { name: 'the-anchoring', version: '0.0.9' })
    expect(state(older.reports[0]?.body)).toBe('stale')
  })
})

describe('openLoopNotices', () => {
  test('names an unclear incident and an escalation with no work item, and nothing else', () => {
    const store = buildStore([
      incident('INC-0001', { upstream_verdict: 'local' }),
      incident('INC-0002', { upstream_verdict: 'unclear', upstream: 'x' }),
      incident('INC-0003', escalatedFields('silent-gate', { upstream_gate: 'verify' })),
      incident('INC-0004', escalatedFields('silent-gate', { upstream_gate: 'verify', upstream_work: 'W-2' })),
    ])
    expect(openLoopNotices(store)).toEqual([
      'INC-0002 sits at verdict `unclear` — decide, or it stays undecided',
      'INC-0003 is escalated upstream with no work item opened',
    ])
  })
})

describe('kb upstream on a real repository', () => {
  function fixture(): string {
    const root = makeTemp('kb-upstream-cli-')
    writeFileSync(
      join(root, 'anchoring.config.json'),
      JSON.stringify({ kbRoot: '.anchor', kinds: { ADR: { dir: 'docs/adr' } } }),
    )
    mkdirSync(join(root, '.anchor', 'incident'), { recursive: true })
    writeFileSync(
      join(root, '.anchor', 'incident', 'INC-0001.md'),
      [
        '---',
        'id: INC-0001',
        'title: The validator refused a field that meant two things',
        'status: open',
        'upstream: the-anchoring',
        'upstream_verdict: upstream',
        'upstream_evidence: schema-gap',
        'upstream_recorded: 2026-08-28',
        'upstream_rejected: "owner: claude"',
        '---',
        '',
        'Body.',
      ].join('\n'),
    )
    writeFileSync(
      join(root, '.anchor', 'incident', 'INC-0002.md'),
      '---\nid: INC-0002\ntitle: Our own bug\nstatus: fixed\nupstream_verdict: local\n---\n\nBody.\n',
    )
    return root
  }

  test('writes one report, prints the banner, and leaves the local incident alone', () => {
    const root = fixture()
    const res = invokeCli(['upstream'], root)

    expect(res.code).toBe(0)
    expect(res.out).toContain('wrote .anchor/upstream/UP-0001.md')
    expect(res.out).toContain(UPSTREAM_BANNER)
    expect(readdirSync(join(root, '.anchor', 'upstream'))).toEqual(['UP-0001.md'])
  })

  test('--dry-run prints the body and writes nothing', () => {
    const root = fixture()
    const res = invokeCli(['upstream', '--dry-run'], root)

    expect(res.code).toBe(0)
    expect(res.out).toContain('--- .anchor/upstream/UP-0001.md ---')
    expect(existsSync(join(root, '.anchor', 'upstream'))).toBe(false)
  })

  test('--check reports missing, then ok, then stale after a hand edit', () => {
    const root = fixture()

    const before = invokeCli(['upstream', '--check'], root)
    expect(before.code).toBe(1)
    expect(before.out).toContain('.anchor/upstream/UP-0001.md: missing')

    invokeCli(['upstream'], root)

    // Still exit 1: escalated with no work item is itself an unclosed loop.
    const after = invokeCli(['upstream', '--check'], root)
    expect(after.out).toContain('.anchor/upstream/UP-0001.md: ok')
    expect(after.out).toContain('INC-0001: escalated to `the-anchoring` with no work item opened')
    expect(after.code).toBe(1)

    const path = join(root, '.anchor', 'upstream', 'UP-0001.md')
    writeFileSync(path, readFileSync(path, 'utf8').replace('package: the-anchoring', 'package: nope'))
    const edited = invokeCli(['upstream', '--check'], root)
    expect(edited.out).toContain('.anchor/upstream/UP-0001.md: hand-edited')
    expect(edited.code).toBe(1)
  })

  test('--list includes the local row', () => {
    const res = invokeCli(['upstream', '--list'], fixture())
    expect(res.code).toBe(0)
    expect(res.out).toContain('INC-0001')
    expect(res.out).toContain('INC-0002')
    expect(res.out).toContain('local')
  })

  test('a generated UP- is not an entity: loadStore does not load it and verify does not check it', () => {
    const root = fixture()
    invokeCli(['upstream'], root)

    const conf = loadConfig(root)
    expect(conf.ok).toBe(true)
    if (!conf.ok) return

    const store = loadStore(conf.config)
    expect([...store.byId.keys()].some((id) => id.startsWith('UP-'))).toBe(false)
    expect(store.problems).toEqual([])
  })
})
