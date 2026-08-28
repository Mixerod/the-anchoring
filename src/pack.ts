/**
 * Pack domain logic: parsing, planning, drift checking, and hashing.
 *
 * Pure module: no filesystem, no crypto, no clock, no process.
 */

import type { AnchoringConfig } from './config.js'
import type { GeneratedFile } from './guards.js'

export interface PackManifest {
  readonly name: string
  readonly version: string
  readonly description: string
}

export interface PackFile {
  readonly kind: 'invariant' | 'hazard' | 'doctrine'
  readonly basename: string
  readonly body: string
}

export interface Pack {
  readonly manifest: PackManifest
  readonly files: readonly PackFile[]
  readonly origin: string
}

export interface PackPlan {
  readonly pack: PackManifest
  readonly files: readonly GeneratedFile[]
  readonly dirs: readonly string[]
  readonly skipped: readonly { readonly path: string; readonly reason: string }[]
  readonly notes: readonly string[]
}

export type PackFileState = 'ok' | 'missing' | 'stale' | 'hand-edited'

export interface PackFileCheckResult {
  readonly path: string
  readonly state: PackFileState
  readonly packName: string
  readonly packVersion: string
}

export interface PackCheckResult {
  readonly pack: PackManifest
  readonly files: readonly PackFileCheckResult[]
}

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/
const NOTES_HEADING = '## Notes'

export function parsePackManifest(
  raw: unknown,
): { readonly ok: true; readonly pack: PackManifest } | { readonly ok: false; readonly problems: readonly string[] } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, problems: ['pack.json must be a JSON object'] }
  }

  const obj = raw as Record<string, unknown>
  const problems: string[] = []
  const allowed = new Set(['name', 'version', 'description'])

  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      problems.push(`unknown field '${key}'; allowed fields are: name, version, description`)
    }
  }

  if (typeof obj['name'] !== 'string' || !NAME_PATTERN.test(obj['name'])) {
    problems.push('name must match ^[a-z][a-z0-9-]*$')
  }

  if (typeof obj['version'] !== 'string' || !VERSION_PATTERN.test(obj['version'])) {
    problems.push('version must be three dot-separated non-negative integers (e.g. 1.0.0)')
  }

  if (typeof obj['description'] !== 'string' || obj['description'].trim().length === 0) {
    problems.push('description must be a non-empty string')
  }

  if (problems.length > 0) {
    return { ok: false, problems }
  }

  return {
    ok: true,
    pack: {
      name: obj['name'] as string,
      version: obj['version'] as string,
      description: obj['description'] as string,
    },
  }
}

function hashableBody(body: string): string {
  const withoutNotes = body.split(`\n${NOTES_HEADING}`)[0] ?? body
  return withoutNotes.replace(/^status: .*$/m, 'status: draft')
}

export function packHash(body: string): string {
  const str = hashableBody(body)
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i))
    hash = (hash * prime) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}

export function packHeader(name: string, version: string, hash: string): string {
  return [
    `<!-- the-anchoring:pack ${name}@${version} hash:${hash} -->`,
    `<!-- Seeded by \`kb pack add ${name}\`. Edit freely — \`kb pack check\` will report it as`,
    '     hand-edited rather than overwrite it. -->',
  ].join('\n')
}

const HEADER_REGEX =
  /^<!-- the-anchoring:pack ([^@\s]+)@(\S+) hash:([0-9a-f]{16}) -->\r?\n<!--[\s\S]*?-->\r?\n\r?\n?/

export function stripPackHeader(content: string): {
  readonly header?: { readonly name: string; readonly version: string; readonly hash: string }
  readonly body: string
} {
  const match = content.match(HEADER_REGEX)
  if (!match || !match[1] || !match[2] || !match[3]) {
    return { body: content }
  }
  return {
    header: {
      name: match[1],
      version: match[2],
      hash: match[3],
    },
    body: content.slice(match[0].length),
  }
}

export function targetPathForFile(kind: PackFile['kind'], basename: string, config: AnchoringConfig): string {
  if (kind === 'invariant') return `${config.kinds.INV.dir}/${basename}`
  if (kind === 'hazard') return `${config.kinds.HAZ.dir}/${basename}`
  return `${config.kbRoot}/doctrine/${basename}`
}

function checkSingleFile(
  file: PackFile,
  actual: string | undefined,
  manifest: PackManifest,
  config: AnchoringConfig,
): PackFileCheckResult {
  const path = targetPathForFile(file.kind, file.basename, config)
  if (actual === undefined) {
    return { path, state: 'missing', packName: manifest.name, packVersion: manifest.version }
  }

  const parsed = stripPackHeader(actual)
  if (!parsed.header) {
    return { path, state: 'hand-edited', packName: manifest.name, packVersion: manifest.version }
  }

  const actualBodyHash = packHash(parsed.body)
  const packCurrentHash = packHash(file.body)

  if (actualBodyHash !== parsed.header.hash) {
    return { path, state: 'hand-edited', packName: parsed.header.name, packVersion: parsed.header.version }
  }
  if (parsed.header.hash !== packCurrentHash) {
    return { path, state: 'stale', packName: parsed.header.name, packVersion: parsed.header.version }
  }
  return { path, state: 'ok', packName: parsed.header.name, packVersion: parsed.header.version }
}

export function planPack(
  pack: Pack,
  config: AnchoringConfig,
  existing: (relPath: string) => string | undefined,
  options?: { readonly force?: boolean },
): PackPlan {
  const hazardCount = pack.files.filter((f) => f.kind === 'hazard').length
  if (hazardCount > config.hazard.ceiling) {
    return {
      pack: pack.manifest,
      files: [],
      dirs: [],
      skipped: [],
      notes: [
        `pack contains ${hazardCount} hazards, exceeding hazard.ceiling (${config.hazard.ceiling}); refused to seed`,
      ],
    }
  }

  const files: GeneratedFile[] = []
  const skipped: { path: string; reason: string }[] = []
  const notes: string[] = []
  const dirSet = new Set<string>()

  for (const file of pack.files) {
    const destPath = targetPathForFile(file.kind, file.basename, config)
    const dir = destPath.substring(0, destPath.lastIndexOf('/'))
    if (dir) dirSet.add(dir)

    const actual = existing(destPath)
    const hash = packHash(file.body)
    const header = packHeader(pack.manifest.name, pack.manifest.version, hash)
    const body = `${header}\n\n${file.body}`

    if (actual === undefined) {
      files.push({ path: destPath, body })
      continue
    }

    const check = checkSingleFile(file, actual, pack.manifest, config)
    if (check.state === 'hand-edited' && !options?.force) {
      skipped.push({ path: destPath, reason: 'hand-edited' })
    } else {
      files.push({ path: destPath, body })
    }
  }

  if (skipped.length > 0) {
    notes.push(`skipped ${skipped.length} hand-edited file(s); use --force to overwrite`)
  }
  if (hazardCount > 0) {
    notes.push(`${hazardCount} hazards seeded; these arrive untriaged and each must be moved to open, guarded or accepted deliberately.`)
  }

  return {
    pack: pack.manifest,
    files,
    dirs: [...dirSet].sort(),
    skipped,
    notes,
  }
}

export function checkPack(
  pack: Pack,
  config: AnchoringConfig,
  read: (relPath: string) => string | undefined,
): PackCheckResult {
  const results: PackFileCheckResult[] = []

  for (const file of pack.files) {
    const destPath = targetPathForFile(file.kind, file.basename, config)
    const actual = read(destPath)
    results.push(checkSingleFile(file, actual, pack.manifest, config))
  }

  return {
    pack: pack.manifest,
    files: results,
  }
}
