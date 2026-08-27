/**
 * `kb init` — bootstrap the intent graph into any repository.
 *
 * Splitting planInit from applyInit makes initialization fully testable without
 * touching a real filesystem, and allows --dry-run to be a direct rendering of the plan.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseConfig, type Layer } from './config.js'
import { planGuards } from './guards.js'

export interface InitOptions {
  readonly kbRoot?: string | undefined
  readonly dryRun?: boolean | undefined
  readonly force?: boolean | undefined
  readonly guards?: boolean | undefined
}

export type FsProbe = (relPath: string) => boolean

export interface InitIo {
  readonly readFile: (relPath: string) => string | undefined
  readonly writeFile: (relPath: string, content: string) => void
  readonly mkdir: (relPath: string) => void
}

export interface InitPlan {
  readonly root: string
  readonly files: readonly { readonly path: string; readonly body: string }[]
  readonly dirs: readonly string[]
  readonly gitignoreLine?: string
  readonly notes: readonly string[]
}

const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../templates')

export function loadTemplate(name: string): string {
  return readFileSync(join(TEMPLATES_DIR, name), 'utf8')
}

const ADR_CANDIDATES = ['docs/adr', 'docs/adrs', 'doc/adr', 'docs/decisions', 'adr'] as const

const GOVERNED_CANDIDATES = [
  'src',
  'packages',
  'apps',
  'lib',
  'services',
  'cmd',
  'internal',
  'scripts',
] as const

const CONVENTIONAL_LAYERS = [
  { name: 'ui', paths: ['src/ui', 'apps'], pure: false },
  { name: 'app', paths: ['src/app'], pure: false },
  { name: 'domain', paths: ['src/domain', 'src/core', 'packages/core'], pure: true },
  { name: 'infra', paths: ['src/infra'], pure: false },
] as const

const MODULE_ROOT_CANDIDATES = ['src/modules', 'packages'] as const

export function findGitRoot(startDir: string): string | undefined {
  let current = startDir
  while (true) {
    if (existsSync(join(current, '.git'))) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}

function formatHoldsFor(paths: readonly string[]): string {
  if (paths.length === 0) return 'holds_for: []'
  return `holds_for:\n${paths.map((p) => `  - file:${p}`).join('\n')}`
}

export function planInit(root: string, options: InitOptions, probe: FsProbe): InitPlan {
  if (probe('anchoring.config.json') && !options.force) {
    throw new Error('anchoring.config.json already exists (use --force to overwrite)')
  }

  const notes: string[] = []

  // Detect ADR directory
  const adrDir = ADR_CANDIDATES.find((c) => probe(c)) ?? 'docs/adr'

  // Detect governedPaths
  const detectedGoverned = GOVERNED_CANDIDATES.filter((c) => probe(c))
  let governedPaths: readonly string[]
  if (detectedGoverned.length > 0) {
    governedPaths = [...detectedGoverned].sort().map((c) => `${c}/`)
  } else {
    governedPaths = ['src/']
    notes.push('no source directory detected; defaulting governedPaths to ["src/"]')
  }

  // Detect symbolIndex
  const symbolIndex: 'codegraph' | 'none' = probe('.codegraph') ? 'codegraph' : 'none'

  const kbRoot = options.kbRoot ?? '.anchor'

  const configObj: Record<string, unknown> = {
    kbRoot,
    kinds: {
      ADR: { dir: adrDir },
      INV: { dir: `${kbRoot}/invariant` },
      FLOW: { dir: `${kbRoot}/flow` },
      WORK: { dir: `${kbRoot}/work` },
      INC: { dir: `${kbRoot}/incident` },
      HAZ: { dir: `${kbRoot}/hazard` },
    },
    governedPaths,
    hazard: {
      openDays: 30,
      ceiling: 24,
    },
    symbolIndex,
  }

  const files: { path: string; body: string }[] = []

  if (options.guards) {
    const detectedLayers: Layer[] = []
    for (const spec of CONVENTIONAL_LAYERS) {
      const foundPaths = spec.paths.filter((p) => probe(p)).map((p) => `${p}/`)
      if (foundPaths.length > 0) {
        detectedLayers.push({
          name: spec.name,
          paths: foundPaths,
          pure: spec.pure,
        })
      }
    }

    const detectedModuleRoots = MODULE_ROOT_CANDIDATES.filter((m) => probe(m)).map((m) => `${m}/`)

    if (detectedLayers.length === 0 && detectedModuleRoots.length === 0) {
      configObj['architecture'] = { layers: [] }
      notes.push(
        'no conventional architecture directories detected; wrote "architecture": { "layers": [] } — fill in your layers in anchoring.config.json',
      )
    } else {
      configObj['architecture'] = {
        layers: detectedLayers,
        ...(detectedModuleRoots.length > 0 ? { moduleRoots: detectedModuleRoots } : {}),
      }

      const allLayerPaths = detectedLayers.flatMap((l) => l.paths)
      const pureLayer = detectedLayers.find((l) => l.pure)
      const purePaths = pureLayer ? pureLayer.paths : []
      const allPaths = [...allLayerPaths, ...detectedModuleRoots]

      files.push(
        {
          path: `${kbRoot}/invariant/INV-NO-CYCLES.md`,
          body: loadTemplate('invariants/INV-NO-CYCLES.md').replace(
            'holds_for: []',
            formatHoldsFor(allPaths),
          ),
        },
        {
          path: `${kbRoot}/invariant/INV-DEP-DIRECTION.md`,
          body: loadTemplate('invariants/INV-DEP-DIRECTION.md').replace(
            'holds_for: []',
            formatHoldsFor(allLayerPaths),
          ),
        },
        {
          path: `${kbRoot}/invariant/INV-MODULE-ENTRY.md`,
          body: loadTemplate('invariants/INV-MODULE-ENTRY.md').replace(
            'holds_for: []',
            formatHoldsFor(detectedModuleRoots.length > 0 ? detectedModuleRoots : allPaths),
          ),
        },
        {
          path: `${kbRoot}/invariant/INV-PURE-CORE.md`,
          body: loadTemplate('invariants/INV-PURE-CORE.md').replace(
            'holds_for: []',
            formatHoldsFor(purePaths.length > 0 ? purePaths : allLayerPaths),
          ),
        },
        {
          path: `${kbRoot}/invariant/INV-FILE-SIZE.md`,
          body: loadTemplate('invariants/INV-FILE-SIZE.md').replace(
            'holds_for: []',
            formatHoldsFor(allPaths),
          ),
        },
      )
    }

    if (probe('package.json')) {
      const parsedConfigRes = parseConfig(root, configObj)
      if (parsedConfigRes.ok) {
        const guardsPlan = planGuards(parsedConfigRes.config)
        for (const f of guardsPlan.files) {
          files.push(f)
        }
        for (const n of guardsPlan.notes) {
          notes.push(n)
        }
      }
    } else {
      notes.push('kb guards: generated checkers currently target TypeScript/JavaScript projects only.')
    }
  }

  const configBody = `${JSON.stringify(configObj, null, 2)}\n`

  const dirs = [
    adrDir,
    `${kbRoot}/invariant`,
    `${kbRoot}/flow`,
    `${kbRoot}/work`,
    `${kbRoot}/incident`,
    `${kbRoot}/hazard`,
    `${kbRoot}/session`,
  ]

  files.push(
    { path: 'anchoring.config.json', body: configBody },
    { path: `${kbRoot}/README.md`, body: loadTemplate('README.md') },
    { path: `${adrDir}/0000-template.md`, body: loadTemplate('adr.md') },
    { path: `${kbRoot}/invariant/0000-template.md`, body: loadTemplate('invariant.md') },
    { path: `${kbRoot}/flow/0000-template.md`, body: loadTemplate('flow.md') },
    { path: `${kbRoot}/work/0000-template.md`, body: loadTemplate('work.md') },
    { path: `${kbRoot}/incident/0000-template.md`, body: loadTemplate('incident.md') },
    { path: `${kbRoot}/hazard/0000-template.md`, body: loadTemplate('hazard.md') },
    { path: `${adrDir}/.gitkeep`, body: '' },
    { path: `${kbRoot}/invariant/.gitkeep`, body: '' },
    { path: `${kbRoot}/flow/.gitkeep`, body: '' },
    { path: `${kbRoot}/work/.gitkeep`, body: '' },
    { path: `${kbRoot}/incident/.gitkeep`, body: '' },
    { path: `${kbRoot}/hazard/.gitkeep`, body: '' },
    { path: `${kbRoot}/session/.gitkeep`, body: '' },
  )

  // Add the three gates to notes
  notes.push(
    'Three gates to protect your intent graph:\n\n' +
      '1. Stop hook (add to .claude/settings.json):\n' +
      JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                matcher: '*',
                hooks: [
                  {
                    type: 'command',
                    command: 'npx kb done --check',
                    timeout: 20,
                  },
                ],
              },
            ],
          },
        },
        null,
        2,
      ) +
      '\n\n' +
      '2. Pre-commit hook (e.g. in .githooks/pre-commit or husky):\n' +
      'npx kb verify\n\n' +
      '3. CI workflow step:\n' +
      'npx kb verify --strict',
  )

  return {
    root,
    files,
    dirs,
    gitignoreLine: `${kbRoot}/session/`,
    notes,
  }
}

export function applyInit(plan: InitPlan, io: InitIo): readonly string[] {
  const written: string[] = []

  for (const dir of plan.dirs) {
    io.mkdir(dir)
  }

  for (const file of plan.files) {
    io.writeFile(file.path, file.body)
    written.push(file.path)
  }

  if (plan.gitignoreLine) {
    const existing = io.readFile('.gitignore')
    if (existing !== undefined) {
      const lines = existing.split(/\r?\n/)
      if (!lines.includes(plan.gitignoreLine)) {
        const trailing = existing.endsWith('\n') || existing === '' ? '' : '\n'
        io.writeFile('.gitignore', `${existing}${trailing}${plan.gitignoreLine}\n`)
        written.push('.gitignore')
      }
    } else {
      io.writeFile('.gitignore', `${plan.gitignoreLine}\n`)
      written.push('.gitignore')
    }
  }

  return written
}

export function defaultFsProbe(root: string): FsProbe {
  return (relPath: string) => existsSync(join(root, relPath))
}

export function defaultInitIo(root: string): InitIo {
  return {
    readFile: (relPath: string) => {
      const path = join(root, relPath)
      if (!existsSync(path)) return undefined
      try {
        return readFileSync(path, 'utf8')
      } catch {
        return undefined
      }
    },
    writeFile: (relPath: string, content: string) => {
      const path = join(root, relPath)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content)
    },
    mkdir: (relPath: string) => {
      const path = join(root, relPath)
      mkdirSync(path, { recursive: true })
    },
  }
}
