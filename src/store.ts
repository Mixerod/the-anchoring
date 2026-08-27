/**
 * Loading the intent graph off disk.
 *
 * Deliberately re-reads every document on every command. The corpus is ~50 files;
 * a full load costs single-digit milliseconds, and no cache means no staleness —
 * the failure mode that killed indexed retrieval in the first place. A persistent
 * index earns its place when `kb search` exists and the corpus is measured, not before.
 */

import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { KIND_SPEC, LINK_FIELDS, SCALAR_FIELDS, kindOf, type EntityKind } from './model.js'
import { readFrontmatter, toList } from './frontmatter.js'

export interface Entity {
  readonly id: string
  readonly kind: EntityKind
  readonly title: string
  readonly status: string
  readonly path: string
  /** Link field name → raw values, exactly as written. Resolution happens later. */
  readonly links: Readonly<Record<string, readonly string[]>>
  /** Non-link frontmatter declared in SCALAR_FIELDS, absent when the document omits it. */
  readonly fields: Readonly<Record<string, string>>
}

/**
 * YAML turns an unquoted `2013-03-11` into a Date, and `String(new Date(...))` yields a
 * long local-time string that no date check would recognise. Normalise back to the ISO
 * day the author actually wrote.
 */
function scalar(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value)
}

export interface LoadProblem {
  readonly path: string
  readonly message: string
}

export interface Store {
  readonly byId: ReadonlyMap<string, Entity>
  readonly problems: readonly LoadProblem[]
}

function listMarkdown(dir: string): readonly string[] {
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

function readEntity(root: string, path: string, expected: EntityKind): Entity | LoadProblem {
  const rel = relative(root, path).split(sep).join('/')
  const parsed = readFrontmatter(path)
  if (!parsed.ok) return { path: rel, message: parsed.reason }

  const { data } = parsed
  const id = typeof data['id'] === 'string' ? data['id'] : ''
  if (!id) return { path: rel, message: 'frontmatter is missing `id`' }
  if (kindOf(id) !== expected) {
    return { path: rel, message: `id \`${id}\` does not match the ${expected} id pattern` }
  }

  const status = typeof data['status'] === 'string' ? data['status'] : ''
  if (!KIND_SPEC[expected].statuses.includes(status)) {
    return {
      path: rel,
      message: `status \`${status}\` is not one of: ${KIND_SPEC[expected].statuses.join(', ')}`,
    }
  }

  const title = typeof data['title'] === 'string' ? data['title'] : ''
  if (!title) return { path: rel, message: 'frontmatter is missing `title`' }

  const links: Record<string, readonly string[]> = {}
  for (const field of Object.keys(LINK_FIELDS[expected])) {
    const values = toList(data[field])
    if (values.length > 0) links[field] = values
  }

  const fields: Record<string, string> = {}
  for (const name of SCALAR_FIELDS[expected]) {
    const value = data[name]
    if (value !== undefined && value !== null) fields[name] = scalar(value)
  }

  return { id, kind: expected, title, status, path: rel, links, fields }
}

export function loadStore(root: string): Store {
  const byId = new Map<string, Entity>()
  const problems: LoadProblem[] = []

  for (const kind of Object.keys(KIND_SPEC) as EntityKind[]) {
    for (const path of listMarkdown(join(root, KIND_SPEC[kind].dir))) {
      const result = readEntity(root, path, kind)
      if ('message' in result) {
        problems.push(result)
        continue
      }
      const clash = byId.get(result.id)
      if (clash) {
        problems.push({ path: result.path, message: `duplicate id \`${result.id}\` (also ${clash.path})` })
        continue
      }
      byId.set(result.id, result)
    }
  }

  return { byId, problems }
}
