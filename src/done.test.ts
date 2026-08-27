import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { done, type Gap } from './done.js'

function fixture(docs: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'kb-done-'))
  for (const [path, body] of Object.entries(docs)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return root
}

const REPO = {
  'docs/adr/0003-tempo.md':
    '---\nid: ADR-0003\ntitle: Tempo Pool\nstatus: accepted\n' +
    'governs:\n  - file:packages/core/src/tempo\n---\n',
  'docs/adr/0008-replay.md':
    '---\nid: ADR-0008\ntitle: Replay by recorded RNG\nstatus: accepted\n' +
    'governs:\n  - file:packages/core/src/command\n---\n',
  '.dicebound/incident/INC-0007.md':
    '---\nid: INC-0007\ntitle: Replay desync\nstatus: open\n' +
    'touches:\n  - file:packages/core/src/command\n---\n',
  '.dicebound/work/W-112.md':
    '---\nid: W-112\ntitle: Tune knight leap cost\nstatus: doing\n' +
    'implements:\n  - ADR-0003\ntouches:\n  - file:packages/core/src/tempo\n---\n',
  '.dicebound/work/W-113.md':
    '---\nid: W-113\ntitle: Shipped work\nstatus: done\n' +
    'implements:\n  - ADR-0003\n---\n',
} as const

const changed = (...files: readonly string[]) => () => files
const kinds = (gaps: readonly Gap[]) => gaps.map((g) => g.kind)

describe('done', () => {
  test('is silent when the change is fully explained and the work is closed', () => {
    const report = done(fixture(REPO), 'W-113', changed('packages/core/src/tempo/costs.ts'))

    expect(report.gaps).toEqual([])
  })

  test('names a decision that governs the change but the work does not claim', () => {
    const report = done(fixture(REPO), 'W-113', changed('packages/core/src/command/types.ts'))
    const gap = report.gaps.find((g) => g.kind === 'unlinked-decision')

    expect(gap?.message).toContain('ADR-0008')
    expect(gap?.fix).toContain('implements: [ADR-0008]')
  })

  test('does not re-report a decision the work already claims', () => {
    const report = done(fixture(REPO), 'W-113', changed('packages/core/src/tempo/costs.ts'))

    expect(kinds(report.gaps)).not.toContain('unlinked-decision')
  })

  test('reports source code no document explains at all', () => {
    const report = done(fixture(REPO), 'W-113', changed('packages/sim/src/rng.ts'))
    const gap = report.gaps.find((g) => g.kind === 'unclaimed-code')

    expect(gap?.message).toContain('packages/sim/src/rng.ts')
  })

  test('chases apps/ and scripts/ as well as packages/', () => {
    const report = done(fixture(REPO), 'W-113', changed('apps/web/src/App.tsx', 'scripts/x.ts'))
    const gap = report.gaps.find((g) => g.kind === 'unclaimed-code')

    expect(gap?.message).toContain('apps/web/src/App.tsx')
    expect(gap?.message).toContain('scripts/x.ts')
  })

  test('does not chase anything outside source, so the signal stays trustworthy', () => {
    // A denylist would make every new config file reappear as a false finding, and a
    // check that cries wolf on every turn gets switched off.
    const report = done(
      fixture(REPO),
      'W-113',
      changed(
        'docs/README.md',
        '.dicebound/work/W-113.md',
        'pnpm-lock.yaml',
        'tools/kb/src/why.ts',
        '.claude/settings.json',
        'AGENTS.md',
        'tsconfig.json',
      ),
    )

    expect(kinds(report.gaps)).not.toContain('unclaimed-code')
  })

  test('asks whether an open incident on the same code was just fixed', () => {
    const report = done(fixture(REPO), 'W-113', changed('packages/core/src/command/types.ts'))
    const gap = report.gaps.find((g) => g.kind === 'open-incident')

    expect(gap?.message).toContain('INC-0007')
    expect(gap?.fix).toContain('closed_by')
  })

  test('reminds that a work item still open is not finished', () => {
    const report = done(fixture(REPO), 'W-112', changed('packages/core/src/tempo/costs.ts'))
    const gap = report.gaps.find((g) => g.kind === 'status')

    expect(gap?.message).toContain('still `doing`')
  })

  test('refuses an id that is not a work item, rather than reporting a false pass', () => {
    const report = done(fixture(REPO), 'ADR-0003', changed())

    expect(report.gaps).toHaveLength(1)
    expect(report.gaps[0]?.message).toContain('no work item')
  })

  test('reports the changed file list it reasoned about', () => {
    const report = done(fixture(REPO), 'W-113', changed('a.ts', 'b.ts'))

    expect(report.changed).toEqual(['a.ts', 'b.ts'])
  })
})
