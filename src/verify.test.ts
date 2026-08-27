import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { verify, type Finding } from './verify.js'

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

const adr = (path: string, body: string): Doc => ({ path: `docs/adr/${path}`, body })
const inv = (path: string, body: string): Doc => ({ path: `.dicebound/invariant/${path}`, body })

const errors = (root: string): readonly Finding[] =>
  verify(root).findings.filter((f) => f.severity === 'error')

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

    expect(verify(root).findings).toEqual([])
    expect(verify(root).entityCount).toBe(2)
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
      adr('0001-a.md', '---\nid: ADR-0001\ntitle: A\nstatus: accepted\ngoverns:\n  - sym:tempoCost\n---\n'),
    )
    const report = verify(root)

    expect(report.indexed).toBe(false)
    expect(report.findings.map((f) => f.severity)).toEqual(['warn'])
    expect(report.anchorCount).toBe(1)
  })

  test('ignores the ADR template, which is a form rather than a decision', () => {
    const root = fixture(adr('0000-template.md', '# ADR-NNNN: title\n\n- **Status:** Proposed\n'))

    expect(verify(root)).toMatchObject({ findings: [], entityCount: 0 })
  })

  test('reports a missing frontmatter block against the document path', () => {
    const root = fixture(adr('0001-a.md', '# ADR-0001: A\n'))

    expect(errors(root)[0]).toMatchObject({
      where: 'docs/adr/0001-a.md',
      message: 'no YAML frontmatter block',
    })
  })
})
