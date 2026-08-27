/**
 * `kb init` — bootstrap the intent graph into any repository.
 *
 * Splitting planInit from applyInit makes initialization fully testable without
 * touching a real filesystem, and allows --dry-run to be a direct rendering of the plan.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface InitOptions {
  readonly kbRoot?: string | undefined
  readonly dryRun?: boolean | undefined
  readonly force?: boolean | undefined
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

  const configObj = {
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

  const files = [
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
  ]

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
