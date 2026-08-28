/**
 * Pack resolution, filesystem loading, and applying.
 *
 * Infra module: interacts with filesystem, environment, and paths.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parsePackManifest, type Pack, type PackFile, type PackPlan } from './pack.js'

export interface PackIo {
  readonly readFile: (relPath: string) => string | undefined
  readonly writeFile: (relPath: string, content: string) => void
  readonly mkdir: (relPath: string) => void
}

export interface PackApplyResult {
  readonly path: string
  readonly action: 'wrote' | 'skipped' | 'unchanged'
  readonly reason?: string
}

export interface ResolveOptions {
  readonly env?: NodeJS.ProcessEnv | Record<string, string | undefined>
  readonly homeDir?: string
  readonly builtInDir?: string
}

const TEMPLATES_PACKS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../templates/packs')

export function userPackDirs(
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>,
  homeDir?: string,
): readonly string[] {
  const dirs: string[] = []
  const envVal = env ? env['ANCHORING_PACKS'] : process.env['ANCHORING_PACKS']

  if (envVal) {
    for (const part of envVal.split(delimiter)) {
      const trimmed = part.trim()
      if (trimmed.length > 0) {
        dirs.push(resolve(trimmed))
      }
    }
  }

  const baseHome = homeDir ?? homedir()
  dirs.push(resolve(join(baseHome, '.anchoring', 'packs')))

  return dirs
}

function readMarkdownFiles(dir: string, kind: PackFile['kind']): readonly PackFile[] {
  if (!existsSync(dir)) return []
  const files: PackFile[] = []
  let entries: readonly string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }

  for (const entry of entries) {
    if (!entry.endsWith('.md') || entry.startsWith('0000-template') || entry.startsWith('.')) {
      continue
    }
    const fullPath = join(dir, entry)
    try {
      if (statSync(fullPath).isFile()) {
        const body = readFileSync(fullPath, 'utf8')
        files.push({ kind, basename: entry, body })
      }
    } catch {
      // Ignore unreadable individual files
    }
  }

  return files.sort((a, b) => a.basename.localeCompare(b.basename))
}

export function loadPack(
  dir: string,
  origin?: string,
): { readonly ok: true; readonly pack: Pack } | { readonly ok: false; readonly problems: readonly string[] } {
  const absDir = resolve(dir)
  const manifestPath = join(absDir, 'pack.json')

  if (!existsSync(manifestPath)) {
    return { ok: false, problems: [`missing pack.json in ${absDir}`] }
  }

  let rawJson: unknown
  try {
    rawJson = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    return { ok: false, problems: [`invalid JSON in ${manifestPath}: ${(error as Error).message}`] }
  }

  const manifestRes = parsePackManifest(rawJson)
  if (!manifestRes.ok) {
    return { ok: false, problems: manifestRes.problems.map((p) => `${manifestPath}: ${p}`) }
  }

  const files: PackFile[] = [
    ...readMarkdownFiles(join(absDir, 'invariant'), 'invariant'),
    ...readMarkdownFiles(join(absDir, 'hazard'), 'hazard'),
    ...readMarkdownFiles(join(absDir, 'doctrine'), 'doctrine'),
  ]

  return {
    ok: true,
    pack: {
      manifest: manifestRes.pack,
      files,
      origin: origin ?? absDir,
    },
  }
}

function scanPackDirectories(
  baseDir: string,
): readonly { readonly dir: string; readonly origin: string }[] {
  if (!existsSync(baseDir)) return []
  const results: { dir: string; origin: string }[] = []

  if (existsSync(join(baseDir, 'pack.json'))) {
    results.push({ dir: baseDir, origin: baseDir })
    return results
  }

  let entries: readonly string[]
  try {
    entries = readdirSync(baseDir)
  } catch {
    return []
  }

  for (const entry of entries) {
    const full = join(baseDir, entry)
    try {
      if (statSync(full).isDirectory() && existsSync(join(full, 'pack.json'))) {
        results.push({ dir: full, origin: full })
      }
    } catch {
      // Ignore
    }
  }

  return results
}

export function resolvePacks(
  options?: ResolveOptions,
): { readonly ok: true; readonly packs: readonly Pack[] } | { readonly ok: false; readonly error: string } {
  const builtIn = options?.builtInDir ?? TEMPLATES_PACKS_DIR
  const searchDirs = [builtIn, ...userPackDirs(options?.env, options?.homeDir)]
  const byName = new Map<string, Pack>()

  for (const searchDir of searchDirs) {
    const found = scanPackDirectories(searchDir)
    for (const item of found) {
      const loadRes = loadPack(item.dir, item.origin)
      if (!loadRes.ok) continue

      const pack = loadRes.pack
      const existing = byName.get(pack.manifest.name)
      if (existing && existing.origin !== pack.origin) {
        return {
          ok: false,
          error: `pack '${pack.manifest.name}' found in multiple locations:\n  - ${existing.origin}\n  - ${pack.origin}`,
        }
      }
      if (!existing) {
        byName.set(pack.manifest.name, pack)
      }
    }
  }

  return {
    ok: true,
    packs: [...byName.values()].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name)),
  }
}

export function findPack(
  name: string,
  options?: ResolveOptions,
): { readonly ok: true; readonly pack: Pack } | { readonly ok: false; readonly error: string } {
  const res = resolvePacks(options)
  if (!res.ok) {
    return { ok: false, error: res.error }
  }
  const pack = res.packs.find((p) => p.manifest.name === name)
  if (!pack) {
    return { ok: false, error: `unknown pack '${name}'` }
  }
  return { ok: true, pack }
}

export function applyPack(plan: PackPlan, io: PackIo): readonly PackApplyResult[] {
  const results: PackApplyResult[] = []

  for (const dir of plan.dirs) {
    io.mkdir(dir)
  }

  for (const file of plan.files) {
    const actual = io.readFile(file.path)
    if (actual === file.body) {
      results.push({ path: file.path, action: 'unchanged' })
    } else {
      io.writeFile(file.path, file.body)
      results.push({ path: file.path, action: 'wrote' })
    }
  }

  for (const s of plan.skipped) {
    results.push({ path: s.path, action: 'skipped', reason: s.reason })
  }

  return results
}

export function defaultPackIo(root: string): PackIo {
  return {
    readFile: (relPath: string) => {
      const full = join(root, relPath)
      if (!existsSync(full)) return undefined
      try {
        return readFileSync(full, 'utf8')
      } catch {
        return undefined
      }
    },
    writeFile: (relPath: string, content: string) => {
      const full = join(root, relPath)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, content)
    },
    mkdir: (relPath: string) => {
      const full = join(root, relPath)
      mkdirSync(full, { recursive: true })
    },
  }
}
