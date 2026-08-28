/**
 * Unit and integration tests for Layer 4 Part A: Packs.
 */

import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parsePackManifest,
  packHash,
  packHeader,
  stripPackHeader,
  planPack,
  checkPack,
  type Pack,
} from './pack.js'
import {
  loadPack,
  resolvePacks,
  findPack,
  userPackDirs,
} from './pack-source.js'
import { defaultConfig } from './config.js'
import { loadStore } from './loader.js'
import { run } from './cli.js'

function makeTemp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('parsePackManifest', () => {
  test('accepts valid manifest with name, version, description', () => {
    const raw = {
      name: 'discipline',
      version: '1.0.0',
      description: 'Engineering discipline pack',
    }
    const res = parsePackManifest(raw)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.pack.name).toBe('discipline')
      expect(res.pack.version).toBe('1.0.0')
      expect(res.pack.description).toBe('Engineering discipline pack')
    }
  })

  test('rejects non-object inputs', () => {
    expect(parsePackManifest(null).ok).toBe(false)
    expect(parsePackManifest('string').ok).toBe(false)
    expect(parsePackManifest([1, 2, 3]).ok).toBe(false)
  })

  test('rejects invalid names', () => {
    expect(parsePackManifest({ name: 'Discipline', version: '1.0.0', description: 'x' }).ok).toBe(false)
    expect(parsePackManifest({ name: '123pack', version: '1.0.0', description: 'x' }).ok).toBe(false)
    expect(parsePackManifest({ name: 'pack_name', version: '1.0.0', description: 'x' }).ok).toBe(false)
  })

  test('rejects invalid versions', () => {
    expect(parsePackManifest({ name: 'pack', version: '1.0', description: 'x' }).ok).toBe(false)
    expect(parsePackManifest({ name: 'pack', version: 'v1.0.0', description: 'x' }).ok).toBe(false)
    expect(parsePackManifest({ name: 'pack', version: '1.0.0-beta', description: 'x' }).ok).toBe(false)
  })

  test('rejects extra unknown keys', () => {
    const raw = {
      name: 'pack',
      version: '1.0.0',
      description: 'x',
      extraField: true,
    }
    const res = parsePackManifest(raw)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.problems[0]).toContain("unknown field 'extraField'")
    }
  })
})

describe('packHash and headers', () => {
  test('packHash matches canonical FNV-1a calculation and normalises status and Notes', () => {
    const bodyA = '---\nid: INV-001\nstatus: active\n---\nRule prose\n\n## Notes\n\nSome notes'
    const bodyB = '---\nid: INV-001\nstatus: draft\n---\nRule prose\n'
    expect(packHash(bodyA)).toBe(packHash(bodyB))
  })

  test('packHeader format and stripPackHeader roundtrip', () => {
    const hash = '3fa9c21b7e04d5a6'
    const header = packHeader('discipline', '1.0.0', hash)
    expect(header).toContain('<!-- the-anchoring:pack discipline@1.0.0 hash:3fa9c21b7e04d5a6 -->')
    expect(header).toContain('<!-- Seeded by `kb pack add discipline`.')

    const fileContent = `${header}\n\n---\nid: INV-001\n---\n`
    const parsed = stripPackHeader(fileContent)
    expect(parsed.header).toBeDefined()
    expect(parsed.header?.name).toBe('discipline')
    expect(parsed.header?.version).toBe('1.0.0')
    expect(parsed.header?.hash).toBe(hash)
    expect(parsed.body).toBe('---\nid: INV-001\n---\n')
  })
})

describe('planPack and checkPack', () => {
  const samplePack: Pack = {
    manifest: {
      name: 'discipline',
      version: '1.0.0',
      description: 'Sample discipline pack',
    },
    files: [
      {
        kind: 'invariant',
        basename: 'INV-SECRETS.md',
        body: '---\nid: INV-SECRETS\ntitle: No secrets\nstatus: active\nenforced_by: []\nholds_for: []\n---\nProse\n',
      },
      {
        kind: 'doctrine',
        basename: 'boundaries.md',
        body: '# Boundaries\n\nDoctrine text\n',
      },
    ],
    origin: '/path/to/pack',
  }

  test('planPack plans files for fresh repository', () => {
    const config = defaultConfig('/repo')
    const existing = () => undefined
    const plan = planPack(samplePack, config, existing)

    expect(plan.files.length).toBe(2)
    expect(plan.files[0]?.path).toBe('.anchor/invariant/INV-SECRETS.md')
    expect(plan.files[1]?.path).toBe('.anchor/doctrine/boundaries.md')
    expect(plan.skipped.length).toBe(0)
  })

  test('planPack skips hand-edited files without --force', () => {
    const config = defaultConfig('/repo')
    const diskFiles = new Map<string, string>()

    // Seed file initially
    const initialHash = packHash(samplePack.files[0]!.body)
    const header = packHeader('discipline', '1.0.0', initialHash)
    diskFiles.set('.anchor/invariant/INV-SECRETS.md', `${header}\n\nModified content by user\n`)

    const plan = planPack(samplePack, config, (p) => diskFiles.get(p))
    expect(plan.skipped.length).toBe(1)
    expect(plan.skipped[0]?.path).toBe('.anchor/invariant/INV-SECRETS.md')
    expect(plan.skipped[0]?.reason).toBe('hand-edited')

    // With force: true, file is planned
    const forcePlan = planPack(samplePack, config, (p) => diskFiles.get(p), { force: true })
    expect(forcePlan.files.some((f) => f.path === '.anchor/invariant/INV-SECRETS.md')).toBe(true)
    expect(forcePlan.skipped.length).toBe(0)
  })

  test('planPack refuses to seed when hazard count exceeds ceiling', () => {
    const config = { ...defaultConfig('/repo'), hazard: { openDays: 30, ceiling: 1 } }
    const packWithManyHazards: Pack = {
      manifest: { name: 'hazards-pack', version: '1.0.0', description: 'desc' },
      files: [
        { kind: 'hazard', basename: 'HAZ-0001.md', body: '...' },
        { kind: 'hazard', basename: 'HAZ-0002.md', body: '...' },
      ],
      origin: '/path',
    }
    const plan = planPack(packWithManyHazards, config, () => undefined)
    expect(plan.files.length).toBe(0)
    expect(plan.notes[0]).toContain('exceeding hazard.ceiling')
  })

  test('checkPack reports ok, missing, hand-edited, and stale', () => {
    const config = defaultConfig('/repo')
    const disk = new Map<string, string>()

    // 1. Missing: no files on disk
    const check1 = checkPack(samplePack, config, (p) => disk.get(p))
    expect(check1.files.every((f) => f.state === 'missing')).toBe(true)

    // 2. Ok: file seeded properly
    const hash = packHash(samplePack.files[0]!.body)
    const header = packHeader('discipline', '1.0.0', hash)
    disk.set('.anchor/invariant/INV-SECRETS.md', `${header}\n\n${samplePack.files[0]!.body}`)
    disk.set(
      '.anchor/doctrine/boundaries.md',
      `${packHeader('discipline', '1.0.0', packHash(samplePack.files[1]!.body))}\n\n${samplePack.files[1]!.body}`,
    )

    const check2 = checkPack(samplePack, config, (p) => disk.get(p))
    expect(check2.files.every((f) => f.state === 'ok')).toBe(true)

    // 3. Hand-edited: local file edited
    disk.set('.anchor/invariant/INV-SECRETS.md', `${header}\n\nEdited text\n`)
    const check3 = checkPack(samplePack, config, (p) => disk.get(p))
    expect(check3.files.find((f) => f.path === '.anchor/invariant/INV-SECRETS.md')?.state).toBe(
      'hand-edited',
    )

    // 4. Stale: pack moved on (pack file body changed/version bumped), disk file still matches old header
    const updatedPack: Pack = {
      ...samplePack,
      manifest: { ...samplePack.manifest, version: '1.1.0' },
      files: [
        {
          kind: 'invariant',
          basename: 'INV-SECRETS.md',
          body: '---\nid: INV-SECRETS\ntitle: New title\nstatus: active\n---\n',
        },
        samplePack.files[1]!,
      ],
    }
    // Restore disk file to old original content matching old header
    disk.set('.anchor/invariant/INV-SECRETS.md', `${header}\n\n${samplePack.files[0]!.body}`)
    const check4 = checkPack(updatedPack, config, (p) => disk.get(p))
    expect(check4.files.find((f) => f.path === '.anchor/invariant/INV-SECRETS.md')?.state).toBe('stale')
  })
})

describe('loadStore ignores .anchor/doctrine/', () => {
  test('loadStore ignores markdown files in .anchor/doctrine/ even with valid frontmatter', () => {
    const root = makeTemp('kb-loadstore-doctrine-')
    const config = defaultConfig(root)

    // Create .anchor/invariant/INV-TEST.md
    mkdirSync(join(root, '.anchor', 'invariant'), { recursive: true })
    writeFileSync(
      join(root, '.anchor', 'invariant', 'INV-TEST.md'),
      '---\nid: INV-TEST\ntitle: Test\nstatus: active\nenforced_by: []\nholds_for: []\n---\n',
    )

    // Create .anchor/doctrine/doctrine.md with frontmatter that looks like an entity
    mkdirSync(join(root, '.anchor', 'doctrine'), { recursive: true })
    writeFileSync(
      join(root, '.anchor', 'doctrine', 'doctrine.md'),
      '---\nid: INV-DOCTRINE-FAKE\ntitle: Fake\nstatus: active\n---\n# Doctrine\n',
    )

    const store = loadStore(config)
    expect(store.byId.has('INV-TEST')).toBe(true)
    expect(store.byId.has('INV-DOCTRINE-FAKE')).toBe(false)
    expect(store.problems.length).toBe(0)
  })
})

describe('Pack resolution and apply', () => {
  test('loadPack and findPack load pack from directory', () => {
    const tempDir = makeTemp('pack-load-')
    mkdirSync(join(tempDir, 'invariant'), { recursive: true })
    mkdirSync(join(tempDir, 'doctrine'), { recursive: true })
    writeFileSync(
      join(tempDir, 'pack.json'),
      JSON.stringify({ name: 'my-loaded-pack', version: '1.0.0', description: 'desc' }),
    )
    writeFileSync(join(tempDir, 'invariant', 'INV-FOO.md'), '---\nid: INV-FOO\n---\n')
    writeFileSync(join(tempDir, 'doctrine', 'doc.md'), '# Doc\n')

    const loadRes = loadPack(tempDir)
    expect(loadRes.ok).toBe(true)
    if (loadRes.ok) {
      expect(loadRes.pack.manifest.name).toBe('my-loaded-pack')
      expect(loadRes.pack.files.length).toBe(2)
    }

    const findRes = findPack('my-loaded-pack', {
      builtInDir: tempDir,
      homeDir: makeTemp('empty-home-'),
    })
    expect(findRes.ok).toBe(true)
  })

  test('userPackDirs respects ANCHORING_PACKS env and default ~/.anchoring/packs', () => {
    const dirs = userPackDirs({ ANCHORING_PACKS: 'C:/custom/packs;D:/other/packs' }, 'C:/Users/test')
    expect(dirs.some((d) => d.includes('custom'))).toBe(true)
    expect(dirs.some((d) => d.includes('other'))).toBe(true)
    expect(dirs.some((d) => d.includes('.anchoring'))).toBe(true)
  })

  test('resolvePacks fails with error when duplicate pack name exists across origins', () => {
    const tempDir1 = makeTemp('pack-dir1-')
    const tempDir2 = makeTemp('pack-dir2-')

    mkdirSync(join(tempDir1, 'mypack'), { recursive: true })
    writeFileSync(
      join(tempDir1, 'mypack', 'pack.json'),
      JSON.stringify({ name: 'mypack', version: '1.0.0', description: 'First' }),
    )

    mkdirSync(join(tempDir2, 'mypack'), { recursive: true })
    writeFileSync(
      join(tempDir2, 'mypack', 'pack.json'),
      JSON.stringify({ name: 'mypack', version: '1.0.0', description: 'Second' }),
    )

    const resolved = resolvePacks({
      env: { ANCHORING_PACKS: `${tempDir1};${tempDir2}` },
      homeDir: makeTemp('empty-home-'),
      builtInDir: makeTemp('empty-builtin-'),
    })

    expect(resolved.ok).toBe(false)
    if (!resolved.ok) {
      expect(resolved.error).toContain("pack 'mypack' found in multiple locations:")
      expect(resolved.error).toContain(tempDir1)
      expect(resolved.error).toContain(tempDir2)
    }
  })
})

describe('CLI kb pack commands and init --pack integration', () => {
  test('kb pack list displays built-in discipline pack', () => {
    const out: string[] = []
    const err: string[] = []
    const code = run(['pack', 'list', '--no-colour'], (t) => out.push(t), (t) => err.push(t))
    expect(code).toBe(0)
    expect(out.join('\n')).toContain('discipline (1.0.0)')
    expect(out.join('\n')).toContain('1 invariant, 5 doctrines, 0 hazards')
  })

  test('kb pack add discipline --dry-run prints would write and does not write', () => {
    const root = makeTemp('kb-pack-dryrun-')
    run(['init', '--no-colour'], () => {}, () => {}, root)

    const out: string[] = []
    const code = run(['pack', 'add', 'discipline', '--dry-run'], (t) => out.push(t), () => {}, root)
    expect(code).toBe(0)
    expect(out.join('\n')).toContain('[dry-run] would write .anchor/invariant/INV-SECRETS-NO-LITERALS.md')
    expect(out.join('\n')).toContain('[dry-run] would write .anchor/doctrine/verification-and-honesty.md')
    expect(existsSync(join(root, '.anchor', 'invariant', 'INV-SECRETS-NO-LITERALS.md'))).toBe(false)
  })

  test('kb pack add discipline seeds pack into clean repo and passes kb verify --strict', () => {
    const root = makeTemp('kb-pack-scratch-')
    run(['init', '--no-colour'], () => {}, () => {}, root)

    const out: string[] = []
    const code = run(['pack', 'add', 'discipline'], (t) => out.push(t), () => {}, root)
    expect(code).toBe(0)
    expect(out.join('\n')).toContain('wrote .anchor/invariant/INV-SECRETS-NO-LITERALS.md')
    expect(out.join('\n')).toContain('wrote .anchor/doctrine/solid.md')

    // Check drift report is ok
    const checkOut: string[] = []
    const checkCode = run(['pack', 'check', '--strict'], (t) => checkOut.push(t), () => {}, root)
    expect(checkCode).toBe(0)
    expect(checkOut.join('\n')).toContain('.anchor/invariant/INV-SECRETS-NO-LITERALS.md')
    expect(checkOut.join('\n')).toContain('ok')

    // Create the checker script so the invariant anchor resolves
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'scripts', 'anchoring-scan-secrets.mjs'), '// checker\n')

    // kb verify --strict should pass cleanly
    const verifyOut: string[] = []
    const verifyCode = run(['verify', '--strict'], (t) => verifyOut.push(t), () => {}, root)
    expect(verifyCode).toBe(0)
    expect(verifyOut.join('\n')).toContain('kb verify: clean')
  })

  test('kb init --pack discipline initializes repo and seeds pack in one step', () => {
    const root = makeTemp('kb-init-pack-')
    const out: string[] = []
    const code = run(['init', '--pack', 'discipline', '--no-colour'], (t) => out.push(t), () => {}, root)
    expect(code).toBe(0)
    expect(existsSync(join(root, '.anchor', 'invariant', 'INV-SECRETS-NO-LITERALS.md'))).toBe(true)
    expect(existsSync(join(root, '.anchor', 'doctrine', 'module-boundaries.md'))).toBe(true)

    const agentsMd = readFileSync(join(root, 'AGENTS.md'), 'utf8')
    expect(agentsMd).toContain('## Engineering doctrine')
    expect(agentsMd).toContain('module-boundaries.md')
  })
})
