/**
 * Intent graph filesystem loader.
 *
 * Re-reads markdown documents from disk on every invocation.
 * Isolates all `node:fs` calls away from the pure domain core.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { ENTITY_KINDS, type EntityKind } from './model.js'
import { parseEntity, buildStore, type Entity, type LoadProblem, type Store } from './store.js'
import { parseFrontmatter, toList, type ParseResult } from './frontmatter.js'
import { parseResidency, type DoctrineSummary } from './doctrine.js'
import { byteLength } from './frontmatter.js'
import type { AnchoringConfig } from './config.js'

export function readFrontmatter(path: string): ParseResult {
  try {
    return parseFrontmatter(readFileSync(path, 'utf8'))
  } catch (error) {
    return { ok: false, reason: `unreadable: ${(error as Error).message}` }
  }
}

/**
 * One file's text, or `undefined` when it cannot be read.
 *
 * Exported so composing readers — `brief-source.ts` — need no `node:fs` import of their own.
 * Every added `readFileSync` is another place the pure/infra boundary has to be re-argued,
 * and the boundary is the redaction guarantee, not a filing convention.
 */
export function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

export function listMarkdown(dir: string): readonly string[] {
  let names: readonly string[]
  try {
    names = readdirSync(dir)
  } catch {
    return [] // a kind with no documents yet is normal, not an error
  }
  return names
    .filter((n) => n.endsWith('.md') && !n.startsWith('0000-template'))
    .map((n) => join(dir, n))
    .filter((p) => statSync(p).isFile())
}

export function readEntity(
  config: AnchoringConfig,
  path: string,
  expected: EntityKind,
): Entity | LoadProblem {
  const rel = relative(config.root, path).split(sep).join('/')
  let rawText: string
  try {
    rawText = readFileSync(path, 'utf8')
  } catch (error) {
    return { path: rel, message: `unreadable: ${(error as Error).message}` }
  }
  return parseEntity(config, rel, expected, rawText)
}

export function loadStore(config: AnchoringConfig): Store {
  const results: (Entity | LoadProblem)[] = []

  for (const kind of ENTITY_KINDS) {
    const kindSpec = config.kinds[kind]
    for (const path of listMarkdown(join(config.root, kindSpec.dir))) {
      results.push(readEntity(config, path, kind))
    }
  }

  return buildStore(results)
}

/** Declared in the pure layer; re-exported here so existing importers keep working. */
export type { DoctrineSummary }

function listMarkdownRecursive(dir: string): readonly string[] {
  let entries: readonly string[]
  try {
    entries = readdirSync(dir, { recursive: true }) as string[]
  } catch {
    return []
  }
  const result: string[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.md') || entry.startsWith('0000-template')) continue
    const full = join(dir, entry)
    try {
      if (statSync(full).isFile()) {
        result.push(full)
      }
    } catch {
      // ignore
    }
  }
  return result
}

/**
 * Read one doctrine file's Tier 1: title, tags, and triggers.
 *
 * Three sources, in falling order of deliberateness. Frontmatter `title:` is a decision;
 * the first `# ` heading is what every doctrine file written before frontmatter existed
 * has; and a file with neither still returns, carrying its name. Nothing here reads the
 * body, which is the whole point of a summary.
 */
function summariseDoctrine(text: string): {
  readonly title?: string
  readonly tags?: readonly string[]
  readonly when?: readonly string[]
  readonly residency: ReturnType<typeof parseResidency>
} {
  const parsed = parseFrontmatter(text)
  const fm = parsed.ok ? parsed.data : {}

  const heading = text.split(/\r?\n/).find((line) => line.startsWith('# '))
  const fmTitle = typeof fm['title'] === 'string' ? fm['title'].trim() : ''
  const title = fmTitle.length > 0 ? fmTitle : heading ? heading.slice(2).trim() : undefined

  const tags = toList(fm['tags']).filter((t) => t.length > 0)
  const when = toList(fm['when']).filter((t) => t.length > 0)

  return {
    ...(title ? { title } : {}),
    ...(tags.length > 0 ? { tags } : {}),
    ...(when.length > 0 ? { when } : {}),
    residency: parseResidency(fm['residency']),
  }
}

export function loadDoctrine(config: AnchoringConfig): readonly DoctrineSummary[] {
  const doctrineDir = join(config.root, config.kbRoot, 'doctrine')
  const paths = listMarkdownRecursive(doctrineDir)
  const summaries: DoctrineSummary[] = []
  for (const p of paths) {
    const rel = relative(config.root, p).split(sep).join('/')
    const relToDoctrine = relative(doctrineDir, p).split(sep).join('/')
    let summary: ReturnType<typeof summariseDoctrine> = { residency: 'brief' }
    try {
      summary = summariseDoctrine(readFileSync(p, 'utf8'))
    } catch {
      // An unreadable doctrine file is still a doctrine file; it lists, it never ranks.
    }
    summaries.push({ path: rel, name: relToDoctrine, ...summary })
  }
  return summaries.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Doctrine summaries paired with what each file costs on disk.
 *
 * Separate from `loadDoctrine` because only the budget check needs the sizes, and `kb ask`
 * runs on every question. Measured in UTF-8 bytes, which is what the file on disk and the
 * request body are both counted in.
 */
export function loadDoctrineSizes(
  config: AnchoringConfig,
): readonly { readonly summary: DoctrineSummary; readonly bytes: number }[] {
  return loadDoctrine(config).map((summary) => ({
    summary,
    bytes: byteLength(readText(join(config.root, summary.path)) ?? ''),
  }))
}
