import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { run } from './cli.js'

function fixture(docs: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'kb-brief-'))
  for (const [path, body] of Object.entries(docs)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return root
}

const doc = (fields: Readonly<Record<string, string>>, body = ''): string =>
  ['---', ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), '---', body].join('\n')

function invoke(argv: readonly string[], root: string, files: readonly string[] = []) {
  const out: string[] = []
  const err: string[] = []
  const code = run(
    [...argv, '--no-colour'],
    (t) => out.push(t),
    (t) => err.push(t),
    root,
    () => files,
  )
  return { code, out: out.join('\n'), err: err.join('\n') }
}

const CORPUS = {
  'AGENTS.md': '# Agent instructions\n',
  '.anchor/doctrine/solid.md': '# SOLID\n',
  '.anchor/invariant/INV-PURE.md': doc(
    { id: 'INV-PURE', title: 'Pure core', status: 'active' },
    'the body',
  ),
  // `governs_nothing` keeps this fixture free of findings, so the no-progress tests below
  // are exercising the counter rather than an incidental warning.
  'docs/adr/0001-a.md': doc({
    id: 'ADR-0001',
    title: 'A decision',
    status: 'accepted',
    governs_nothing: 'names the project',
  }),
  '.anchor/flow/FLOW-0001.md': doc({ id: 'FLOW-0001', title: 'A flow', status: 'live' }),
  '.anchor/work/W-1.md': doc({ id: 'W-1', title: 'Some work', status: 'doing' }),
}

describe('kb brief', () => {
  test('emits four tiers in the documented order', () => {
    const result = invoke(['brief'], fixture(CORPUS))

    expect(result.code).toBe(0)
    const levels = [...result.out.matchAll(/<!-- kb:brief:tier:(\d) /g)].map((m) => m[1])
    expect(levels).toEqual(['1', '2', '3', '4'])
  })

  test('places AGENTS.md and doctrine in tier 1, above the invariants', () => {
    const out = invoke(['brief'], fixture(CORPUS)).out

    expect(out.indexOf('AGENTS.md')).toBeLessThan(out.indexOf('INV-PURE'))
    expect(out.indexOf('INV-PURE')).toBeLessThan(out.indexOf('FLOW-0001'))
    expect(out.indexOf('FLOW-0001')).toBeLessThan(out.indexOf('W-1'))
  })

  test('--json gives one object per tier', () => {
    const result = invoke(['brief', '--json'], fixture(CORPUS))
    const report = JSON.parse(result.out) as {
      tiers: { level: number; content: string }[]
      generated_from: string[]
    }

    expect(result.code).toBe(0)
    expect(report.tiers).toHaveLength(4)
    expect(report.tiers.map((t) => t.level)).toEqual([1, 2, 3, 4])
    expect(report.generated_from).toContain('AGENTS.md')
  })

  test('--check exits 0 on a stable corpus and says what it compared', () => {
    const result = invoke(['brief', '--check'], fixture(CORPUS))

    expect(result.code).toBe(0)
    expect(result.out).toContain('byte-stable across 2 independent loads')
    // The boundary the tool must not blur: it proves stability, not a cache hit.
    expect(result.out).toContain('cache_read_input_tokens')
  })

  test('two consecutive runs are byte-identical', () => {
    const root = fixture(CORPUS)

    expect(invoke(['brief'], root).out).toBe(invoke(['brief'], root).out)
  })

  test('carries no ANSI escape sequences', () => {
    // The bundle is written for an agent. An escape sequence is a token it pays for and
    // cannot use.
    expect(invoke(['brief'], fixture(CORPUS)).out).not.toContain(String.fromCharCode(27))
  })

  test('rejects an unknown flag rather than silently ignoring it', () => {
    const result = invoke(['brief', '--tier=2'], fixture(CORPUS))

    expect(result.code).toBe(2)
    expect(result.err).toContain('unknown option')
  })
})

describe('kb verify --since', () => {
  test('exits 2 and names the problem when the ref is unreadable', () => {
    // Never degrade to "nothing changed": that would exit 0 having checked nothing.
    const result = invoke(['verify', '--since', 'no-such-ref'], fixture(CORPUS))

    expect(result.code).toBe(2)
    expect(result.err).toContain('no-such-ref')
  })

  test('exits 2 with usage when --since is given no ref', () => {
    const result = invoke(['verify', '--since'], fixture(CORPUS))

    expect(result.code).toBe(2)
    expect(result.err).toContain('usage: kb verify --since')
  })
})

describe('kb verify --fingerprint', () => {
  test('prints a stable digest of the finding set', () => {
    const root = fixture(CORPUS)
    const first = invoke(['verify', '--fingerprint'], root)

    expect(first.code).toBe(0)
    expect(first.out.trim()).toMatch(/^[0-9a-f]{16}$/)
    expect(invoke(['verify', '--fingerprint'], root).out).toBe(first.out)
  })
})

describe('kb done --check — no-progress detection', () => {
  /** A corpus with one permanent error, so the finding set repeats. */
  const STUCK = {
    ...CORPUS,
    '.anchor/work/W-1.md': doc({
      id: 'W-1',
      title: 'Some work',
      status: 'doing',
      implements: '[ADR-9999]',
    }),
  }

  test('warns on the third identical run, and never fails the turn', () => {
    const root = fixture(STUCK)
    const runs = [1, 2, 3].map(() => invoke(['done', 'W-1', '--check'], root))

    expect(runs.map((r) => r.code)).toEqual([0, 0, 0])
    expect(runs[0]?.out).not.toContain('no progress')
    expect(runs[1]?.out).not.toContain('no progress')
    expect(runs[2]?.out).toContain('no progress across 3 runs')
  })

  test('stays silent on a clean corpus however often it runs', () => {
    const root = fixture(CORPUS)
    const runs = [1, 2, 3, 4].map(() => invoke(['done', 'W-1', '--check'], root))

    for (const r of runs) {
      expect(r.code).toBe(0)
      expect(r.out).not.toContain('no progress')
    }
  })

  test('fixing the finding resets the counter', () => {
    const root = fixture(STUCK)
    invoke(['done', 'W-1', '--check'], root)
    invoke(['done', 'W-1', '--check'], root)

    // Repair the dangling reference, then run a third time.
    writeFileSync(
      join(root, '.anchor/work/W-1.md'),
      doc({ id: 'W-1', title: 'Some work', status: 'doing' }),
    )
    const third = invoke(['done', 'W-1', '--check'], root)

    expect(third.code).toBe(0)
    expect(third.out).not.toContain('no progress')
  })
})
