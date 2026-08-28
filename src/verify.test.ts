import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { verify, type Finding } from './verify.js'
import { defaultConfig } from './config.js'
import { loadConfig } from './root.js'

interface Doc {
  readonly path: string
  readonly body: string
}

function fixture(...docs: readonly Doc[]): string {
  const root = mkdtempSync(join(tmpdir(), 'kb-verify-'))
  for (const doc of docs) {
    const full = join(root, doc.path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, doc.body)
  }
  return root
}

const conf = (root: string) => defaultConfig(root)

const adr = (path: string, body: string): Doc => ({ path: `docs/adr/${path}`, body })
const inv = (path: string, body: string): Doc => ({ path: `.anchor/invariant/${path}`, body })

const errors = (root: string): readonly Finding[] =>
  verify(conf(root)).findings.filter((f) => f.severity === 'error')

describe('verify', () => {
  test('passes a document whose anchors and references all resolve', () => {
    const root = fixture(
      { path: 'src/costs.ts', body: 'export const cost = 2\n' },
      inv('INV-X.md', '---\nid: INV-X\ntitle: X holds\nstatus: active\n---\n'),
      adr(
        '0001-a.md',
        '---\nid: ADR-0001\ntitle: A\nstatus: accepted\ngovers_typo: ignored\ngoverns:\n  - file:src/costs.ts\nconstrains:\n  - INV-X\n---\n',
      ),
    )

    expect(verify(conf(root)).findings).toEqual([])
    expect(verify(conf(root)).entityCount).toBe(2)
  })

  test('fails an anchor pointing at a file that no longer exists', () => {
    const root = fixture(
      adr('0001-a.md', '---\nid: ADR-0001\ntitle: A\nstatus: accepted\ngoverns:\n  - file:src/moved.ts\n---\n'),
    )
    const [finding] = errors(root)

    expect(finding?.message).toContain('file:src/moved.ts')
    expect(finding?.hint).toContain('update the anchor in the same commit')
  })

  test('fails a reference to an entity that does not exist', () => {
    const root = fixture(
      adr('0001-a.md', '---\nid: ADR-0001\ntitle: A\nstatus: accepted\nconstrains:\n  - INV-GHOST\n---\n'),
    )
    const [finding] = errors(root)

    expect(finding?.message).toContain('INV-GHOST')
    expect(finding?.hint).toContain('create the INV document')
  })

  test('fails a reference whose target is the wrong kind', () => {
    const root = fixture(
      adr('0001-a.md', '---\nid: ADR-0001\ntitle: A\nstatus: accepted\n---\n'),
      adr(
        '0002-b.md',
        '---\nid: ADR-0002\ntitle: B\nstatus: accepted\nconstrains:\n  - ADR-0001\n---\n',
      ),
    )

    expect(errors(root)[0]?.message).toContain('only accepts INV')
  })

  test('fails an id that does not match its kind pattern', () => {
    const root = fixture(adr('0001-a.md', '---\nid: DEC-1\ntitle: A\nstatus: accepted\n---\n'))

    expect(errors(root)[0]?.message).toContain('does not match the ADR id pattern')
  })

  test('fails a status outside the allowed set for its kind', () => {
    const root = fixture(adr('0001-a.md', '---\nid: ADR-0001\ntitle: A\nstatus: wip\n---\n'))

    expect(errors(root)[0]?.message).toContain('status `wip` is not one of')
  })

  test('fails a document with a duplicate id', () => {
    const root = fixture(
      adr('0001-a.md', '---\nid: ADR-0001\ntitle: A\nstatus: accepted\n---\n'),
      adr('0001-copy.md', '---\nid: ADR-0001\ntitle: A again\nstatus: accepted\n---\n'),
    )

    expect(errors(root)[0]?.message).toContain('duplicate id')
  })

  test('fails a superseded ADR that no successor claims', () => {
    const root = fixture(adr('0001-a.md', '---\nid: ADR-0001\ntitle: A\nstatus: superseded\n---\n'))

    expect(errors(root)[0]?.message).toContain('no other ADR claims to supersede it')
  })

  test('passes a superseded ADR once a successor claims it', () => {
    const root = fixture(
      adr('0001-a.md', '---\nid: ADR-0001\ntitle: A\nstatus: superseded\n---\n'),
      adr(
        '0002-b.md',
        '---\nid: ADR-0002\ntitle: B\nstatus: accepted\nsupersedes:\n  - ADR-0001\n---\n',
      ),
    )

    expect(errors(root)).toEqual([])
  })

  test('warns rather than fails on symbol anchors when the repo is not indexed', () => {
    const root = fixture(
      adr('0001-a.md', '---\nid: ADR-0001\ntitle: A\nstatus: accepted\ngoverns:\n  - sym:calculateCost\n---\n'),
    )
    const report = verify(conf(root))

    expect(report.indexed).toBe(false)
    expect(report.findings.map((f) => f.severity)).toEqual(['warn'])
    expect(report.anchorCount).toBe(1)
  })

  test('ignores the ADR template, which is a form rather than a decision', () => {
    const root = fixture(adr('0000-template.md', '# ADR-NNNN: title\n\n- **Status:** Proposed\n'))

    expect(verify(conf(root))).toMatchObject({ findings: [], entityCount: 0 })
  })

  test('reports a missing frontmatter block against the document path', () => {
    const root = fixture(adr('0001-a.md', '# ADR-0001: A\n'))

    expect(errors(root)[0]).toMatchObject({
      where: 'docs/adr/0001-a.md',
      message: 'no YAML frontmatter block',
    })
  })
})

describe('executed_by is a free string (T19)', () => {
  test('a work item may name the agent that did the work, in any shape', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-executed-by-'))
    writeFileSync(
      join(root, 'anchoring.config.json'),
      JSON.stringify({ kbRoot: '.anchor', kinds: { ADR: { dir: 'docs/adr' } } }),
    )
    mkdirSync(join(root, '.anchor', 'work'), { recursive: true })

    for (const [id, value] of [
      ['W-1', 'claude'],
      ['W-2', 'agent'],
      ['W-3', 'antigravity'],
      ['W-4', 'unassigned'],
    ]) {
      writeFileSync(
        join(root, '.anchor', 'work', `${id}.md`),
        `---\nid: ${id}\ntitle: Some work\nstatus: done\nexecuted_by: ${value}\n---\n\nBody.\n`,
      )
    }

    const conf = loadConfig(root)
    expect(conf.ok).toBe(true)
    if (!conf.ok) return

    const report = verify(conf.config)
    expect(report.findings).toEqual([])
    expect(report.entityCount).toBe(4)
  })

  test('`owner` keeps its shape — the fix is a second field, not a looser first one', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-owner-still-shaped-'))
    writeFileSync(
      join(root, 'anchoring.config.json'),
      JSON.stringify({ kbRoot: '.anchor', kinds: { ADR: { dir: 'docs/adr' } } }),
    )
    mkdirSync(join(root, '.anchor', 'work'), { recursive: true })
    writeFileSync(
      join(root, '.anchor', 'work', 'W-1.md'),
      '---\nid: W-1\ntitle: Some work\nstatus: done\nowner: claude\nexecuted_by: claude\n---\n\nBody.\n',
    )

    const conf = loadConfig(root)
    if (!conf.ok) throw new Error('config did not load')

    const findings = verify(conf.config).findings
    expect(findings.length).toBe(1)
    expect(findings[0]?.where).toBe('W-1 · owner')
  })
})

describe('tags field validation on all six kinds (Layer 4 Part B)', () => {
  test('tags: accepted on all six kinds when formatted as a list of lowercase slugs', () => {
    const root = fixture(
      { path: 'src/app.ts', body: 'export const x = 1\n' },
      adr('0001-a.md', '---\nid: ADR-0001\ntitle: A\nstatus: accepted\ngoverns:\n  - file:src/app.ts\ntags:\n  - arch\n  - module-boundaries\n---\n'),
      inv('INV-A.md', '---\nid: INV-A\ntitle: Inv\nstatus: active\ntags:\n  - pure-core\n  - layering\n---\n'),
      { path: '.anchor/flow/FLOW-0001.md', body: '---\nid: FLOW-0001\ntitle: Flow\nstatus: live\ntags:\n  - auth\n---\n' },
      { path: '.anchor/work/W-1.md', body: '---\nid: W-1\ntitle: Work\nstatus: done\ntags:\n  - refactor\n---\n' },
      { path: '.anchor/incident/INC-0001.md', body: '---\nid: INC-0001\ntitle: Inc\nstatus: fixed\ntags:\n  - cli\n  - bugfix\n---\n' },
      {
        path: '.anchor/hazard/HAZ-0001.md',
        body: '---\nid: HAZ-0001\ntitle: Haz\nstatus: active\nsource: https://example.com/h\nobserved: 2026-01-01\nrecorded: 2026-01-02\nresolution: accepted\nreason: tested\nholds_for:\n  - file:src/app.ts\ntags:\n  - security\n---\n',
      },
    )

    const report = verify(conf(root))

    // No errors: well-formed slugs are accepted on every kind, which is what this test is
    // about. Layer 5 added a second, corpus-level pass, and every tag in this fixture is
    // used exactly once — so it now also produces advisory singleton warnings. Those are
    // asserted rather than ignored: a check that fires here and goes unmentioned is a check
    // somebody deletes later believing it was noise.
    expect(report.findings.filter((f) => f.severity === 'error')).toEqual([])
    expect(report.findings.every((f) => f.advisory === true)).toBe(true)
    expect(report.findings.every((f) => f.message.includes('used exactly once'))).toBe(true)
    expect(report.entityCount).toBe(6)
  })

  test('fails when tags is not a list (e.g. a bare string or number)', () => {
    const root = fixture(
      adr('0001-a.md', '---\nid: ADR-0001\ntitle: A\nstatus: accepted\ngoverns_nothing: reason\ntags: not-a-list\n---\n'),
    )
    const [finding] = errors(root)
    expect(finding?.where).toBe('ADR-0001 · tags')
    expect(finding?.message).toContain('must be a list of lowercase slugs')
    expect(finding?.message).toContain('not-a-list')
  })

  test('fails when a tag in the list is not a lowercase slug, naming the offending value', () => {
    const root = fixture(
      adr('0001-a.md', '---\nid: ADR-0001\ntitle: A\nstatus: accepted\ngoverns_nothing: reason\ntags:\n  - valid-slug\n  - Invalid_Slug!\n---\n'),
    )
    const [finding] = errors(root)
    expect(finding?.where).toBe('ADR-0001 · tags')
    expect(finding?.message).toContain('is not a lowercase slug')
    expect(finding?.message).toContain('Invalid_Slug!')
  })
})

