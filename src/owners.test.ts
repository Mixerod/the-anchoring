import { describe, expect, test } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verify } from './verify.js'
import { why } from './why.js'
import { loadConfig } from './root.js'
import { run } from './cli.js'
import {
  resolveOwners,
  resolveOwnerForPath,
  renderCodeowners,
  OWNERS_START_MARKER,
  OWNERS_END_MARKER,
} from './owners.js'
import type { Entity } from './store.js'

function makeTemp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

function invokeCli(argv: readonly string[], root: string) {
  const out: string[] = []
  const err: string[] = []
  const code = run([...argv, '--no-colour'], (t) => out.push(t), (t) => err.push(t), root)
  return { code, out: out.join('\n'), err: err.join('\n') }
}

function dummyEntity(id: string, kind: Entity['kind'], owner?: string, anchors: readonly string[] = []): Entity {
  return {
    id,
    kind,
    title: `Test ${id}`,
    status: 'accepted',
    path: `docs/${id}.md`,
    links: { governs: anchors },
    fields: owner ? { owner } : {},
  }
}

describe('owner shape validation in verify', () => {
  test('accepts @handle and team:x and rejects invalid shapes', () => {
    const root = makeTemp('kb-owner-val-')
    writeFileSync(
      join(root, 'anchoring.config.json'),
      JSON.stringify({
        kinds: { ADR: { dir: 'docs/adr' } },
        governedPaths: ['src/'],
      }),
    )
    mkdirSync(join(root, 'docs', 'adr'), { recursive: true })
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'index.ts'), 'export const x = 1\n')

    // Valid @handle
    writeFileSync(
      join(root, 'docs', 'adr', 'ADR-0001.md'),
      '---\nid: ADR-0001\ntitle: First\nstatus: accepted\nowner: "@alice"\ngoverns:\n  - file:src/index.ts\n---\nBody\n',
    )
    // Valid team:name
    writeFileSync(
      join(root, 'docs', 'adr', 'ADR-0002.md'),
      '---\nid: ADR-0002\ntitle: Second\nstatus: accepted\nowner: "team:core-dev"\ngoverns:\n  - file:src/index.ts\n---\nBody\n',
    )

    const conf1 = loadConfig(root)
    expect(conf1.ok).toBe(true)
    if (!conf1.ok) return
    const rep1 = verify(conf1.config)
    expect(rep1.findings.filter((f) => f.where.includes('owner'))).toEqual([])

    // Invalid: plain username without @ or team:
    writeFileSync(
      join(root, 'docs', 'adr', 'ADR-0003.md'),
      '---\nid: ADR-0003\ntitle: Third\nstatus: accepted\nowner: "plain-user"\ngoverns:\n  - file:src/index.ts\n---\nBody\n',
    )
    // Invalid: trailing colon
    writeFileSync(
      join(root, 'docs', 'adr', 'ADR-0004.md'),
      '---\nid: ADR-0004\ntitle: Fourth\nstatus: accepted\nowner: "team:"\ngoverns:\n  - file:src/index.ts\n---\nBody\n',
    )
    // Invalid: empty @
    writeFileSync(
      join(root, 'docs', 'adr', 'ADR-0005.md'),
      '---\nid: ADR-0005\ntitle: Fifth\nstatus: accepted\nowner: "@"\ngoverns:\n  - file:src/index.ts\n---\nBody\n',
    )

    const rep2 = verify(conf1.config)
    const ownerFindings = rep2.findings.filter((f) => f.where.includes('owner'))
    expect(ownerFindings.length).toBe(3)
    for (const f of ownerFindings) {
      expect(f.message).toContain('must be shaped `@handle` or `team:<name>`')
    }
  })
})

describe('resolveOwners and resolveOwnerForPath', () => {
  test('a single owner over one anchor', () => {
    const entities = [dummyEntity('ADR-0001', 'ADR', '@Mixerod', ['file:src/config.ts'])]
    const { mappings, notes } = resolveOwners(entities)
    expect(mappings).toEqual([{ path: 'src/config.ts', owner: '@Mixerod', via: 'ADR-0001' }])
    expect(notes).toEqual([])

    const resolved = resolveOwnerForPath('src/config.ts', entities)
    expect(resolved).toEqual({ owner: '@Mixerod', via: 'ADR-0001' })
  })

  test('two entities over overlapping anchors → longest match wins, with the note', () => {
    const entities = [
      dummyEntity('ADR-0001', 'ADR', 'team:infra', ['file:src/']),
      dummyEntity('W-12', 'WORK', '@Mixerod', ['file:src/verify.ts']),
    ]

    const { mappings, notes } = resolveOwners(entities)
    expect(mappings.length).toBe(2)
    expect(notes.some((n) => n.includes('takes precedence over broader claim'))).toBe(true)

    // For the specific file src/verify.ts, @Mixerod wins because length 13 > length 4
    const resolvedSpecific = resolveOwnerForPath('src/verify.ts', entities)
    expect(resolvedSpecific).toEqual({ owner: '@Mixerod', via: 'W-12' })

    // For another file src/other.ts, team:infra wins
    const resolvedOther = resolveOwnerForPath('src/other.ts', entities)
    expect(resolvedOther).toEqual({ owner: 'team:infra', via: 'ADR-0001' })
  })

  test('resolveOwnerForPath returns undefined when no owner covers the path', () => {
    const entities = [dummyEntity('ADR-0001', 'ADR', '@alice', ['file:src/ui/'])]
    expect(resolveOwnerForPath('src/infra/db.ts', entities)).toBeUndefined()
  })
})

describe('renderCodeowners', () => {
  test('marker block is preserved when surrounding comments exist', () => {
    const existing = `# Custom CODEOWNERS header\n\n${OWNERS_START_MARKER}\nold\n${OWNERS_END_MARKER}\n\n# Custom footer\n`
    const mappings = [{ path: 'src/index.ts', owner: '@Mixerod', via: 'ADR-0001' }]
    const rendered = renderCodeowners(mappings, existing)

    expect(rendered.startsWith('# Custom CODEOWNERS header')).toBe(true)
    expect(rendered.endsWith('# Custom footer\n')).toBe(true)
    expect(rendered).toContain('src/index.ts                   @Mixerod')
    expect(rendered).not.toContain('\nold\n')
  })
})

describe('kb owners CLI', () => {
  test('no owners anywhere → command says so and writes nothing', () => {
    const root = makeTemp('kb-owners-none-')
    writeFileSync(join(root, 'anchoring.config.json'), JSON.stringify({ kinds: { ADR: { dir: 'docs/adr' } } }))

    const result = invokeCli(['owners'], root)
    expect(result.code).toBe(0)
    expect(result.out).toContain('no owners declared in any entity')
    expect(existsSync(join(root, 'CODEOWNERS'))).toBe(false)
  })

  test('.github/CODEOWNERS is preferred when .github/ exists', () => {
    const root = makeTemp('kb-owners-github-')
    writeFileSync(join(root, 'anchoring.config.json'), JSON.stringify({ kinds: { ADR: { dir: 'docs/adr' } } }))
    mkdirSync(join(root, '.github'))
    mkdirSync(join(root, 'docs', 'adr'), { recursive: true })
    writeFileSync(
      join(root, 'docs', 'adr', 'ADR-0001.md'),
      '---\nid: ADR-0001\ntitle: First\nstatus: accepted\nowner: "@Mixerod"\ngoverns:\n  - file:src/index.ts\n---\nBody\n',
    )

    const result = invokeCli(['owners'], root)
    expect(result.code).toBe(0)
    expect(existsSync(join(root, '.github', 'CODEOWNERS'))).toBe(true)
    expect(existsSync(join(root, 'CODEOWNERS'))).toBe(false)

    const content = readFileSync(join(root, '.github', 'CODEOWNERS'), 'utf8')
    expect(content).toContain('src/index.ts                   @Mixerod')
  })

  test('--check exits 1 on drift and 0 when in sync', () => {
    const root = makeTemp('kb-owners-check-')
    writeFileSync(join(root, 'anchoring.config.json'), JSON.stringify({ kinds: { ADR: { dir: 'docs/adr' } } }))
    mkdirSync(join(root, 'docs', 'adr'), { recursive: true })
    writeFileSync(
      join(root, 'docs', 'adr', 'ADR-0001.md'),
      '---\nid: ADR-0001\ntitle: First\nstatus: accepted\nowner: "@Mixerod"\ngoverns:\n  - file:src/index.ts\n---\nBody\n',
    )

    // Check before write -> missing (exit 1)
    const check1 = invokeCli(['owners', '--check'], root)
    expect(check1.code).toBe(1)
    expect(check1.out).toContain('CODEOWNERS: missing')

    // Run write
    const writeRes = invokeCli(['owners'], root)
    expect(writeRes.code).toBe(0)

    // Check after write -> ok (exit 0)
    const check2 = invokeCli(['owners', '--check'], root)
    expect(check2.code).toBe(0)
    expect(check2.out).toContain('CODEOWNERS: ok')

    // Modify file -> stale (exit 1)
    writeFileSync(join(root, 'CODEOWNERS'), 'stale content')
    const check3 = invokeCli(['owners', '--check'], root)
    expect(check3.code).toBe(1)
    expect(check3.out).toContain('CODEOWNERS: stale')
  })

  test('kb why prints the owner line only when an owner exists', () => {
    const root = makeTemp('kb-why-owners-')
    writeFileSync(
      join(root, 'anchoring.config.json'),
      JSON.stringify({
        kinds: { ADR: { dir: 'docs/adr' } },
        governedPaths: ['src/'],
      }),
    )
    mkdirSync(join(root, 'docs', 'adr'), { recursive: true })
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(join(root, 'src', 'owned.ts'), 'export const a = 1\n')
    writeFileSync(join(root, 'src', 'unowned.ts'), 'export const b = 2\n')

    writeFileSync(
      join(root, 'docs', 'adr', 'ADR-0001.md'),
      '---\nid: ADR-0001\ntitle: First\nstatus: accepted\nowner: "@Mixerod"\ngoverns:\n  - file:src/owned.ts\n---\nBody\n',
    )
    writeFileSync(
      join(root, 'docs', 'adr', 'ADR-0002.md'),
      '---\nid: ADR-0002\ntitle: Second\nstatus: accepted\ngoverns:\n  - file:src/unowned.ts\n---\nBody\n',
    )

    const conf = loadConfig(root)
    expect(conf.ok).toBe(true)
    if (!conf.ok) return

    const whyOwned = why(conf.config, 'src/owned.ts')
    expect(whyOwned.owner).toEqual({ owner: '@Mixerod', via: 'ADR-0001' })

    const whyCliOwned = invokeCli(['why', 'src/owned.ts'], root)
    expect(whyCliOwned.out).toContain('owner: @Mixerod (via ADR-0001)')

    const whyUnowned = why(conf.config, 'src/unowned.ts')
    expect(whyUnowned.owner).toBeUndefined()

    const whyCliUnowned = invokeCli(['why', 'src/unowned.ts'], root)
    expect(whyCliUnowned.out).not.toContain('owner:')
  })

  test('kb owners prints formatted table with Path, Owner, Via columns', () => {
    const root = makeTemp('kb-owners-table-')
    writeFileSync(join(root, 'anchoring.config.json'), JSON.stringify({ kinds: { ADR: { dir: 'docs/adr' } } }))
    mkdirSync(join(root, 'docs', 'adr'), { recursive: true })
    writeFileSync(
      join(root, 'docs', 'adr', 'ADR-0001.md'),
      '---\nid: ADR-0001\ntitle: First\nstatus: accepted\nowner: "@Mixerod"\ngoverns:\n  - file:src/index.ts\n---\nBody\n',
    )

    const res = invokeCli(['owners'], root)
    expect(res.code).toBe(0)
    expect(res.out).toContain('Path                           Owner       Via')
    expect(res.out).toContain('src/index.ts                   @Mixerod    ADR-0001')
    expect(res.out).toContain('kb owners: wrote CODEOWNERS')
  })

  test('kb owners --check exits 0 when no owners declared anywhere', () => {
    const root = makeTemp('kb-owners-empty-check-')
    writeFileSync(join(root, 'anchoring.config.json'), JSON.stringify({ kinds: { ADR: { dir: 'docs/adr' } } }))

    const res = invokeCli(['owners', '--check'], root)
    expect(res.code).toBe(0)
    expect(res.out).toContain('CODEOWNERS: ok (no owners declared)')
  })
})
