/**
 * `kb upstream --open-work` — writing into somebody else's repository.
 *
 * Most of these tests are refusals, and that is the shape of the feature. Approved scope
 * is narrow: generate the report, open the work item, stop. Anything less certain than
 * that is a refusal, and the snapshot test is what proves nothing else upstream moved.
 */
import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addUpstreamWork, nextWorkId, reportPackage } from './upstream.js'
import { parseDirty, type IsDirty } from './git.js'
import { runUpstream } from './cli-upstream.js'
import { loadConfig } from './root.js'

const CLEAN: IsDirty = () => false
const DIRTY: IsDirty = () => true
const UNKNOWN: IsDirty = () => undefined

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** A downstream repository with one escalated incident, ready to carry upstream. */
function downstream(): string {
  const root = tempDir('kb-down-')
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
      'title: One field carried two concepts',
      'status: open',
      'upstream: the-anchoring',
      'upstream_verdict: upstream',
      'upstream_evidence: schema-gap',
      'upstream_recorded: 2026-08-28',
      'upstream_rejected: "owner: claude"',
      '---',
      '',
      'Body.',
      '',
    ].join('\n'),
  )
  return root
}

/** An upstream repository that provides `the-anchoring`. */
function upstream(packageName = 'the-anchoring'): string {
  const root = tempDir('kb-up-')
  writeFileSync(
    join(root, 'anchoring.config.json'),
    JSON.stringify({ kbRoot: '.anchor', kinds: { ADR: { dir: 'docs/adr' } } }),
  )
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: packageName, version: '0.1.0' }))
  mkdirSync(join(root, '.anchor', 'work'), { recursive: true })
  writeFileSync(
    join(root, '.anchor', 'work', 'W-3.md'),
    '---\nid: W-3\ntitle: Existing\nstatus: done\n---\n\nBody.\n',
  )
  return root
}

function invoke(root: string, rest: readonly string[], isDirty = CLEAN) {
  const conf = loadConfig(root)
  if (!conf.ok) throw new Error(conf.problems.join('; '))
  const out: string[] = []
  const err: string[] = []
  const code = runUpstream(
    conf.config,
    rest,
    (t) => out.push(t),
    (t) => err.push(t),
    isDirty,
  )
  return { code, out: out.join('\n'), err: err.join('\n') }
}

/** Every file under a root, relative and sorted, so "nothing else moved" is checkable. */
function snapshot(root: string, rel = ''): readonly string[] {
  const here = join(root, rel)
  return readdirSync(here, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? snapshot(root, join(rel, e.name)) : [join(rel, e.name).split('\\').join('/')],
    )
    .sort()
}

describe('the pure helpers', () => {
  test('reportPackage reads the package line back', () => {
    expect(reportPackage('---\nid: UP-0001\npackage: the-anchoring\n---\n')).toBe('the-anchoring')
    expect(reportPackage('---\nid: UP-0001\n---\n')).toBeUndefined()
  })

  test('nextWorkId takes the highest and adds one, and never reuses a gap', () => {
    expect(nextWorkId([])).toBe('W-1')
    expect(nextWorkId(['W-1', 'W-2', 'W-9'])).toBe('W-10')
    expect(nextWorkId(['W-1', 'W-5'])).toBe('W-6')
    expect(nextWorkId(['not-a-work-id'])).toBe('W-1')
  })

  test('addUpstreamWork inserts after the upstream block, and is idempotent', () => {
    const text = '---\nid: INC-0001\nupstream: x\nupstream_verdict: upstream\nstatus: open\n---\n\nBody\n'
    const once = addUpstreamWork(text, 'W-4')
    expect(once).toContain('upstream_verdict: upstream\nupstream_work: W-4\nstatus: open')
    expect(addUpstreamWork(once, 'W-9')).toBe(once)
  })

  test('addUpstreamWork leaves a document with no frontmatter alone', () => {
    expect(addUpstreamWork('no frontmatter here\n', 'W-4')).toBe('no frontmatter here\n')
    expect(addUpstreamWork('---\nunterminated\n', 'W-4')).toBe('---\nunterminated\n')
  })

  test('parseDirty is true only when git printed something', () => {
    expect(parseDirty('')).toBe(false)
    expect(parseDirty('\n  \n')).toBe(false)
    expect(parseDirty(' M src/a.ts\n')).toBe(true)
  })
})

describe('refusals', () => {
  test('a path with no anchoring.config.json is refused', () => {
    const down = downstream()
    const res = invoke(down, ['--open-work', tempDir('kb-not-a-repo-')])
    expect(res.code).toBe(1)
    expect(res.err).toContain('has no anchoring.config.json')
  })

  test('a package mismatch is refused, naming both the expected and the found package', () => {
    const down = downstream()
    const up = upstream('some-other-package')
    const res = invoke(down, ['--open-work', up])

    expect(res.code).toBe(1)
    expect(res.err).toContain('provides `some-other-package`')
    expect(res.err).toContain('names `the-anchoring`')
  })

  test('a dirty upstream tree is refused', () => {
    const res = invoke(downstream(), ['--open-work', upstream()], DIRTY)
    expect(res.code).toBe(1)
    expect(res.err).toContain('has uncommitted changes')
  })

  test('an unreadable git status is refused too — "could not tell" is not permission', () => {
    const res = invoke(downstream(), ['--open-work', upstream()], UNKNOWN)
    expect(res.code).toBe(1)
    expect(res.err).toContain('cannot read git status')
  })

  test('a work item that already references this UP- is refused', () => {
    const down = downstream()
    const up = upstream()
    invoke(down, [])
    writeFileSync(
      join(up, '.anchor', 'work', 'W-4.md'),
      '---\nid: W-4\ntitle: Already filed\nstatus: todo\n---\n\nAbout UP-0001.\n',
    )

    // Clear the downstream `upstream_work` so it is the duplicate check that refuses.
    const incPath = join(down, '.anchor', 'incident', 'INC-0001.md')
    writeFileSync(incPath, readFileSync(incPath, 'utf8').replace(/^upstream_work: .*$\n/m, ''))

    const res = invoke(down, ['--open-work', up])
    expect(res.code).toBe(1)
    expect(res.err).toContain('already references UP-0001')
  })
})

describe('the happy path', () => {
  test('writes the work item, stamps the incident, and touches nothing else upstream', () => {
    const down = downstream()
    const up = upstream()
    const before = snapshot(up)

    const res = invoke(down, ['--open-work', up])
    expect(res.code).toBe(0)

    // Exactly one new file upstream, in the configured WORK.dir, at the next free id.
    const after = snapshot(up)
    expect(after.filter((f) => !before.includes(f))).toEqual(['.anchor/work/W-4.md'])
    expect(before.every((f) => after.includes(f))).toBe(true)

    const work = readFileSync(join(up, '.anchor', 'work', 'W-4.md'), 'utf8')
    expect(work).toContain('id: W-4')
    expect(work).toContain('status: todo')
    expect(work).toContain('One field carried two concepts')
    expect(work).toContain('UP-0001')
    expect(work).toContain('INC-0001')

    // The downstream repository is named by its directory, never by its path.
    expect(work).toContain(down.split(/[\\/]/).pop() ?? '')
    expect(work).not.toContain(down)
    expect(work).not.toMatch(/[A-Za-z]:\\/)

    // The incident gains upstream_work; the generated UP- is byte-identical afterwards.
    expect(readFileSync(join(down, '.anchor', 'incident', 'INC-0001.md'), 'utf8')).toContain(
      'upstream_work: W-4',
    )
    expect(res.out).toContain('.anchor/work/W-4.md')
    expect(res.out).toContain('.anchor/incident/INC-0001.md')
  })

  test('the generated UP- file is byte-identical afterwards', () => {
    const down = downstream()
    const up = upstream()
    invoke(down, [])
    const reportPath = join(down, '.anchor', 'upstream', 'UP-0001.md')
    const before = readFileSync(reportPath, 'utf8')

    invoke(down, ['--open-work', up])
    expect(readFileSync(reportPath, 'utf8')).toBe(before)
  })

  test('running it twice writes nothing the second time', () => {
    const down = downstream()
    const up = upstream()

    invoke(down, ['--open-work', up])
    const upAfterFirst = snapshot(up)
    const downAfterFirst = snapshot(down).map((f) => readFileSync(join(down, f), 'utf8'))

    const second = invoke(down, ['--open-work', up])
    expect(second.code).toBe(0)
    expect(second.out).toContain('every escalated incident already has a work item')
    expect(snapshot(up)).toEqual(upAfterFirst)
    expect(snapshot(down).map((f) => readFileSync(join(down, f), 'utf8'))).toEqual(downAfterFirst)
  })

  test('nothing is committed in either repository', () => {
    // Neither repository is a git repository at all in this fixture; a command that tried
    // to commit would fail loudly rather than silently succeed.
    const down = downstream()
    const up = upstream()
    expect(invoke(down, ['--open-work', up]).code).toBe(0)
    expect(snapshot(up)).not.toContain('.git')
    expect(snapshot(down)).not.toContain('.git')
  })

  test('--open-work=<path> is accepted as well as --open-work <path>', () => {
    const down = downstream()
    const up = upstream()
    expect(invoke(down, [`--open-work=${up}`]).code).toBe(0)
    expect(snapshot(up)).toContain('.anchor/work/W-4.md')
  })
})
