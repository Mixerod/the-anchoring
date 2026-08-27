import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { unclaimedWork } from './done.js'
import { verify } from './verify.js'
import { defaultConfig } from './config.js'

/**
 * INC-0001: six files landed in `apps/` and no gate said a word, because the Stop hook is
 * silent when no work item is open and every gate downstream is keyed on a work id the
 * agent supplies voluntarily.
 *
 * The tests below are the two guards W-61 adds. Both are deliberately non-blocking — a
 * bookkeeping gate that fails a turn is switched off within a week, and then nothing is
 * enforced at all. Breaking the silence is the whole objective.
 */

interface Doc {
  readonly path: string
  readonly body: string
}

function fixture(...docs: readonly Doc[]): string {
  const root = mkdtempSync(join(tmpdir(), 'kb-unclaimed-'))
  for (const doc of docs) {
    const full = join(root, doc.path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, doc.body)
  }
  return root
}

const conf = (root: string = '.') => defaultConfig(root)
const adr = (name: string, body: string): Doc => ({ path: `docs/adr/${name}`, body })

describe('unclaimedWork — the Stop hook stops being silent', () => {
  test('reports source files changed with no work item open', () => {
    const report = unclaimedWork(conf(), () => ['apps/web/src/board.tsx', 'src/x.ts'])

    expect(report).not.toBeNull()
    expect(report?.files).toEqual(['apps/web/src/board.tsx', 'src/x.ts'])
  })

  test('names the files, so the message is actionable rather than a scold', () => {
    const report = unclaimedWork(conf(), () => ['apps/web/src/board.tsx'])

    expect(report?.message).toContain('apps/web/src/board.tsx')
    expect(report?.fix).toContain('kb ctx')
  })

  test('stays silent for docs — the case the silence was written for', () => {
    expect(unclaimedWork(conf(), () => ['docs/adr/0019-x.md', 'README.md'])).toBeNull()
  })

  test('stays silent for the knowledge base itself', () => {
    expect(unclaimedWork(conf(), () => ['.anchor/work/W-61.md', 'docs/rules.md'])).toBeNull()
  })

  test('stays silent for config, which is why this is an allowlist and not a denylist', () => {
    expect(unclaimedWork(conf(), () => ['package.json', 'tsconfig.json', 'pnpm-lock.yaml'])).toBeNull()
  })

  test('stays silent on an empty diff', () => {
    expect(unclaimedWork(conf(), () => [])).toBeNull()
  })

  test('reports a mixed diff — one governed file among docs is still unexplained work', () => {
    const report = unclaimedWork(conf(), () => ['README.md', 'packages/sim/src/match.ts'])

    expect(report?.files).toEqual(['packages/sim/src/match.ts'])
  })
})

describe('verify — an accepted ADR that governs nothing', () => {
  const accepted = (governs: string): Doc =>
    adr('0001-a.md', `---\nid: ADR-0001\ntitle: A\nstatus: accepted\n${governs}---\n`)

  test('warns, so --strict fails it in CI but a local commit is not blocked', () => {
    const root = fixture(accepted('governs: []\n'))
    const findings = verify(conf(root)).findings

    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('warn')
    expect(findings[0]?.message).toContain('governs nothing')
    expect(findings[0]?.hint).toContain('promise')
  })

  test('warns when governs is absent entirely, not only when it is an empty list', () => {
    const root = fixture(accepted(''))

    expect(verify(conf(root)).findings[0]?.severity).toBe('warn')
  })

  test('is clean once the ADR anchors something', () => {
    const root = fixture(
      { path: 'src/thing.ts', body: 'export const x = 1\n' },
      accepted('governs:\n  - file:src/thing.ts\n'),
    )

    expect(verify(conf(root)).findings).toEqual([])
  })

  test('leaves a proposed ADR alone — it has not claimed to bind anything yet', () => {
    const root = fixture(adr('0001-a.md', '---\nid: ADR-0001\ntitle: A\nstatus: proposed\n---\n'))

    expect(verify(conf(root)).findings).toEqual([])
  })

  test('leaves a superseded ADR alone, so history does not generate noise forever', () => {
    const root = fixture(
      adr('0001-a.md', '---\nid: ADR-0001\ntitle: A\nstatus: superseded\n---\n'),
      adr('0002-b.md', '---\nid: ADR-0002\ntitle: B\nstatus: proposed\nsupersedes:\n  - ADR-0001\n---\n'),
    )

    expect(verify(conf(root)).findings).toEqual([])
  })
})

describe('governs_nothing — the declared exception', () => {
  test('silences the warning when a reason is given', () => {
    const root = fixture(
      adr(
        '0001-a.md',
        '---\nid: ADR-0001\ntitle: A\nstatus: accepted\ngoverns: []\n' +
          'governs_nothing: removes scope, binds no code path\n---\n',
      ),
    )

    expect(verify(conf(root)).findings).toEqual([])
  })

  test('an empty reason does not count — the field must say something', () => {
    const root = fixture(
      adr('0001-a.md', '---\nid: ADR-0001\ntitle: A\nstatus: accepted\ngoverns_nothing: "  "\n---\n'),
    )

    expect(verify(conf(root)).findings[0]?.severity).toBe('warn')
  })
})
