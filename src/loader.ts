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
import { parseFrontmatter, type ParseResult } from './frontmatter.js'
import type { AnchoringConfig } from './config.js'

export function readFrontmatter(path: string): ParseResult {
  try {
    return parseFrontmatter(readFileSync(path, 'utf8'))
  } catch (error) {
    return { ok: false, reason: `unreadable: ${(error as Error).message}` }
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
