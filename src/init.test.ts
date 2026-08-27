import { describe, expect, test } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { applyInit, planInit, type FsProbe, type InitIo } from './init.js'
import { run } from './cli.js'
import { verify } from './verify.js'
import { why } from './why.js'
import { loadConfig } from './config.js'

function memFs(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial))
  const dirs = new Set<string>()

  const probe: FsProbe = (relPath: string) => {
    if (files.has(relPath)) return true
    if (dirs.has(relPath)) return true
    // If any file starts with relPath + '/'
    for (const key of files.keys()) {
      if (key.startsWith(`${relPath}/`)) return true
    }
    return false
  }

  const io: InitIo = {
    readFile: (relPath: string) => files.get(relPath),
    writeFile: (relPath: string, content: string) => {
      files.set(relPath, content)
    },
    mkdir: (relPath: string) => {
      dirs.add(relPath)
    },
  }

  return { files, dirs, probe, io }
}

function invokeCli(argv: readonly string[], root: string) {
  const out: string[] = []
  const err: string[] = []
  const code = run([...argv, '--no-colour'], (t) => out.push(t), (t) => err.push(t), root)
  return { code, out: out.join('\n'), err: err.join('\n') }
}

describe('planInit', () => {
  test('a bare temp directory produces a config with governedPaths: ["src/"] and the "no source directory detected" note', () => {
    const { probe } = memFs()
    const plan = planInit('/repo', {}, probe)

    const configFile = plan.files.find((f) => f.path === 'anchoring.config.json')
    expect(configFile).toBeDefined()
    const parsed = JSON.parse(configFile!.body)
    expect(parsed.governedPaths).toEqual(['src/'])
    expect(plan.notes.some((n) => n.includes('no source directory detected'))).toBe(true)
  })

  test('src/ present → ["src/"]; packages/ + apps/ present → both, sorted, slash-suffixed', () => {
    const { dirs: d1, probe: p1 } = memFs()
    d1.add('src')
    const plan1 = planInit('/repo', {}, p1)
    const conf1 = JSON.parse(plan1.files.find((f) => f.path === 'anchoring.config.json')!.body)
    expect(conf1.governedPaths).toEqual(['src/'])

    const { dirs: d2, probe: p2 } = memFs()
    d2.add('packages')
    d2.add('apps')
    const plan2 = planInit('/repo', {}, p2)
    const conf2 = JSON.parse(plan2.files.find((f) => f.path === 'anchoring.config.json')!.body)
    expect(conf2.governedPaths).toEqual(['apps/', 'packages/'])
  })

  test('docs/adrs existing is detected in preference to the default docs/adr', () => {
    const { dirs, probe } = memFs()
    dirs.add('docs/adrs')
    const plan = planInit('/repo', {}, probe)
    const conf = JSON.parse(plan.files.find((f) => f.path === 'anchoring.config.json')!.body)
    expect(conf.kinds.ADR.dir).toBe('docs/adrs')
  })

  test('.codegraph/ present → symbolIndex: "codegraph"; absent → "none"', () => {
    const { dirs: d1, probe: p1 } = memFs()
    d1.add('.codegraph')
    const plan1 = planInit('/repo', {}, p1)
    const conf1 = JSON.parse(plan1.files.find((f) => f.path === 'anchoring.config.json')!.body)
    expect(conf1.symbolIndex).toBe('codegraph')

    const { probe: p2 } = memFs()
    const plan2 = planInit('/repo', {}, p2)
    const conf2 = JSON.parse(plan2.files.find((f) => f.path === 'anchoring.config.json')!.body)
    expect(conf2.symbolIndex).toBe('none')
  })

  test('refuses when anchoring.config.json exists; --force overwrites', () => {
    const { files, probe } = memFs({ 'anchoring.config.json': '{}' })

    expect(() => planInit('/repo', {}, probe)).toThrow(/already exists/)
    expect(() => planInit('/repo', { force: true }, probe)).not.toThrow()
    expect(files.size).toBe(1) // verify nothing was written during planning
  })

  test('--dry-run writes nothing and lists every path it would write', () => {
    const { files, probe } = memFs()
    const plan = planInit('/repo', { dryRun: true }, probe)
    // planInit is pure planning, does not invoke io
    expect(files.size).toBe(0)
    expect(plan.files.length).toBeGreaterThan(5)
    expect(plan.dirs.length).toBeGreaterThan(5)
  })

  test('.gitignore gains the session line exactly once, even when run twice', () => {
    const { files, probe, io } = memFs({ '.gitignore': 'node_modules\n' })
    const plan = planInit('/repo', {}, probe)
    applyInit(plan, io)

    expect(files.get('.gitignore')).toBe('node_modules\n.anchor/session/\n')

    // Run a second time with the updated .gitignore
    applyInit(plan, io)
    expect(files.get('.gitignore')).toBe('node_modules\n.anchor/session/\n')
  })

  test('the six kind directories and their .gitkeep files are created', () => {
    const { probe, io } = memFs()
    const plan = planInit('/repo', {}, probe)
    const written = applyInit(plan, io)

    const requiredDirs = [
      'docs/adr',
      '.anchor/invariant',
      '.anchor/flow',
      '.anchor/work',
      '.anchor/incident',
      '.anchor/hazard',
      '.anchor/session',
    ]
    for (const dir of requiredDirs) {
      expect(plan.dirs).toContain(dir)
      expect(written).toContain(`${dir}/.gitkeep`)
    }
  })

  test('--kb-root docs/kb moves the whole tree and the config agrees', () => {
    const { probe } = memFs()
    const plan = planInit('/repo', { kbRoot: 'docs/kb' }, probe)
    const conf = JSON.parse(plan.files.find((f) => f.path === 'anchoring.config.json')!.body)

    expect(conf.kbRoot).toBe('docs/kb')
    expect(conf.kinds.INV.dir).toBe('docs/kb/invariant')
    expect(conf.kinds.WORK.dir).toBe('docs/kb/work')
    expect(plan.dirs).toContain('docs/kb/invariant')
    expect(plan.gitignoreLine).toBe('docs/kb/session/')
  })
})

describe('init --guards', () => {
  test('detects conventional layers for each directory', () => {
    const { dirs, probe } = memFs({ 'package.json': '{}' })
    dirs.add('src/ui')
    dirs.add('src/app')
    dirs.add('src/domain')
    dirs.add('src/infra')

    const plan = planInit('/repo', { guards: true }, probe)
    const conf = JSON.parse(plan.files.find((f) => f.path === 'anchoring.config.json')!.body)

    expect(conf.architecture).toBeDefined()
    expect(conf.architecture.layers.map((l: { name: string }) => l.name)).toEqual([
      'ui',
      'app',
      'domain',
      'infra',
    ])
    expect(conf.architecture.layers[2].pure).toBe(true)
  })

  test('detects packages/ and src/modules/ as moduleRoots', () => {
    const { dirs, probe } = memFs({ 'package.json': '{}' })
    dirs.add('packages')
    dirs.add('src/modules')

    const plan = planInit('/repo', { guards: true }, probe)
    const conf = JSON.parse(plan.files.find((f) => f.path === 'anchoring.config.json')!.body)

    expect(conf.architecture.moduleRoots).toEqual(['src/modules/', 'packages/'])
  })

  test('nothing detected → empty layers, the note, and no INV- files', () => {
    const { probe } = memFs({ 'package.json': '{}' })
    const plan = planInit('/repo', { guards: true }, probe)
    const conf = JSON.parse(plan.files.find((f) => f.path === 'anchoring.config.json')!.body)

    expect(conf.architecture).toEqual({ layers: [] })
    expect(plan.notes.some((n) => n.includes('no conventional architecture directories detected'))).toBe(true)
    const invFiles = plan.files.filter((f) => f.path.startsWith('.anchor/invariant/INV-'))
    expect(invFiles.length).toBe(0)
  })

  test('--guards writes exactly five INV- documents when layers detected', () => {
    const { dirs, probe } = memFs({ 'package.json': '{}' })
    dirs.add('src/domain')
    dirs.add('src/infra')

    const plan = planInit('/repo', { guards: true }, probe)
    const invFiles = plan.files.filter((f) => f.path.startsWith('.anchor/invariant/INV-'))
    expect(invFiles.length).toBe(5)

    const names = invFiles.map((f) => f.path.split('/').pop())
    expect(names).toEqual([
      'INV-NO-CYCLES.md',
      'INV-DEP-DIRECTION.md',
      'INV-MODULE-ENTRY.md',
      'INV-PURE-CORE.md',
      'INV-FILE-SIZE.md',
    ])

    const pureDoc = invFiles.find((f) => f.path.endsWith('INV-PURE-CORE.md'))
    expect(pureDoc?.body).toContain('file:src/domain/')
  })

  test('--guards in a non-JS directory writes config but no generated checker files and says so', () => {
    const { dirs, probe } = memFs() // no package.json
    dirs.add('src/domain')

    const plan = planInit('/repo', { guards: true }, probe)
    expect(plan.files.some((f) => f.path === 'anchoring.guards.mjs')).toBe(false)
    expect(plan.files.some((f) => f.path === 'anchoring.depcruise.cjs')).toBe(false)
    expect(plan.notes.some((n) => n.includes('generated checkers currently target TypeScript/JavaScript'))).toBe(true)
  })
})

describe('init integration and verification', () => {
  test('every written template parses: after init, verify on that tree returns zero findings and entityCount === 0', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'kb-init-test-'))
    try {
      const initResult = invokeCli(['init'], scratch)
      expect(initResult.code).toBe(0)

      const confResult = loadConfig(scratch)
      expect(confResult.ok).toBe(true)
      if (!confResult.ok) return

      const report = verify(confResult.config)
      expect(report.findings).toEqual([])
      expect(report.entityCount).toBe(0)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  test('CLI: refuses when config exists without --force, succeeds with --force', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'kb-init-cli-'))
    try {
      const first = invokeCli(['init'], scratch)
      expect(first.code).toBe(0)

      const second = invokeCli(['init'], scratch)
      expect(second.code).toBe(1)
      expect(second.err).toContain('anchoring.config.json already exists')

      const forced = invokeCli(['init', '--force'], scratch)
      expect(forced.code).toBe(0)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  test('CLI: --dry-run prints plan without writing files', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'kb-init-dry-'))
    try {
      const result = invokeCli(['init', '--dry-run'], scratch)
      expect(result.code).toBe(0)
      expect(result.out).toContain('dry run')
      expect(result.out).toContain('anchoring.config.json')

      // Config file should not exist on disk
      expect(existsSync(join(scratch, 'anchoring.config.json'))).toBe(false)
      expect(existsSync(join(scratch, '.anchor'))).toBe(false)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  test('Acceptance: in a fresh temp git repo with src/domain and src/infra, kb init --guards && kb verify --strict exits 0', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'kb-init-acc-guards-'))
    try {
      mkdirSync(join(scratch, '.git'))
      mkdirSync(join(scratch, 'src', 'domain'), { recursive: true })
      mkdirSync(join(scratch, 'src', 'infra'), { recursive: true })
      writeFileSync(join(scratch, 'package.json'), JSON.stringify({ name: 'temp-app' }))

      const initResult = invokeCli(['init', '--guards'], scratch)
      expect(initResult.code).toBe(0)

      const confResult = loadConfig(scratch)
      expect(confResult.ok).toBe(true)
      if (!confResult.ok) return

      const report = verify(confResult.config)
      expect(report.findings).toEqual([])
      expect(report.entityCount).toBe(5)

      const whyDomain = why(confResult.config, 'src/domain')
      const mentionedIds = whyDomain.mentions.map((m) => m.entity.id)
      expect(mentionedIds).toContain('INV-PURE-CORE')
      expect(mentionedIds).toContain('INV-FILE-SIZE')
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })
})
