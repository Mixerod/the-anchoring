/**
 * Intent graph store domain models and pure parsing.
 *
 * Defines the Entity, Store, and LoadProblem types, and pure validation
 * over parsed frontmatter. Filesystem I/O is isolated to infra/loader.ts.
 */

import { LINK_FIELDS, SCALAR_FIELDS, kindOf, type EntityKind } from './model.js'
import { parseFrontmatter, toList, bodyAfterFrontmatter, byteLength } from './frontmatter.js'
import type { AnchoringConfig } from './config.js'

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
  /**
   * UTF-8 size of the prose after the frontmatter fence.
   *
   * Carried on the entity because the raw text is already in hand at parse time, so the
   * body budget costs no second read. Optional so that a hand-built entity in a test need
   * not invent a number it does not care about; absent means "not measured", never zero.
   */
  readonly bodyBytes?: number
}

/**
 * YAML turns an unquoted `2013-03-11` into a Date, and `String(new Date(...))` yields a
 * long local-time string that no date check would recognise. Normalise back to the ISO
 * day the author actually wrote.
 */
function scalar(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return JSON.stringify(value)
  }
  return String(value)
}

export interface LoadProblem {
  readonly path: string
  readonly message: string
}

export interface Store {
  readonly byId: ReadonlyMap<string, Entity>
  readonly problems: readonly LoadProblem[]
}

export function parseEntity(
  config: AnchoringConfig,
  relPath: string,
  expected: EntityKind,
  rawText: string,
): Entity | LoadProblem {
  const parsed = parseFrontmatter(rawText)
  if (!parsed.ok) return { path: relPath, message: parsed.reason }

  const { data } = parsed
  const id = typeof data['id'] === 'string' ? data['id'] : ''
  if (!id) return { path: relPath, message: 'frontmatter is missing `id`' }
  if (kindOf(config, id) !== expected) {
    return { path: relPath, message: `id \`${id}\` does not match the ${expected} id pattern` }
  }

  const status = typeof data['status'] === 'string' ? data['status'] : ''
  const kindSpec = config.kinds[expected]
  if (!kindSpec.statuses.includes(status)) {
    return {
      path: relPath,
      message: `status \`${status}\` is not one of: ${kindSpec.statuses.join(', ')}`,
    }
  }

  const title = typeof data['title'] === 'string' ? data['title'] : ''
  if (!title) return { path: relPath, message: 'frontmatter is missing `title`' }

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

  return {
    id,
    kind: expected,
    title,
    status,
    path: relPath,
    links,
    fields,
    bodyBytes: byteLength(bodyAfterFrontmatter(rawText)),
  }
}

export function buildStore(
  results: readonly (Entity | LoadProblem)[],
): Store {
  const byId = new Map<string, Entity>()
  const problems: LoadProblem[] = []

  for (const result of results) {
    if ('message' in result) {
      problems.push(result)
      continue
    }
    const clash = byId.get(result.id)
    if (clash) {
      problems.push({
        path: result.path,
        message: `duplicate id \`${result.id}\` (also ${clash.path})`,
      })
      continue
    }
    byId.set(result.id, result)
  }

  return { byId, problems }
}
