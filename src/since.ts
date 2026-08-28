/**
 * `kb verify --since <ref>` — the delta form.
 *
 * Two reasons, and the second is the one that pays for this module:
 *
 * 1. A loop iteration should not re-derive what it already knows.
 * 2. **It keeps the prefix stable.** Re-rendering the full report each iteration rewrites the
 *    agent's context and destroys the cache; appending only the delta leaves the prefix
 *    intact. Append-only is the whole principle underneath Layer 5.
 *
 * Pure module. The changed-path list is produced by `git.ts` and passed in as an argument,
 * because git is infra and this is not.
 */

import { LINK_FIELDS } from './model.js'
import { anchorCovers, parseAnchor } from './anchors.js'
import type { Entity, Store } from './store.js'
import type { Finding } from './finding.js'

/**
 * The entity a finding is about.
 *
 * `where` is written by every checker in one of two shapes: `INC-0003` or
 * `INC-0003 · touches`. A load problem uses the file path instead, because at that point
 * there is no entity to name. Splitting on the separator covers all three without asking
 * twenty checkers to carry a new field they would forget to populate.
 */
export function findingSubject(where: string): string {
  const [head] = where.split(' · ')
  return (head ?? where).trim()
}

function anchoredFiles(entity: Entity): readonly string[] {
  const spec = LINK_FIELDS[entity.kind]
  return Object.entries(entity.links)
    .filter(([field]) => spec[field]?.kind === 'anchor')
    .flatMap(([, values]) => values)
    .flatMap((raw) => {
      const anchor = parseAnchor(raw)
      // A `sym:` anchor names a symbol, not a path, so it cannot be matched against a diff.
      // Such an entity is reached only when its own document changed — stated here rather
      // than discovered later by someone wondering why a rename went unreported.
      return anchor?.form === 'file' ? [anchor.value] : []
    })
}

export interface SinceReport {
  readonly ref: string
  readonly changed: readonly string[]
  readonly findings: readonly Finding[]
  /** Entities the diff reaches, whether or not they produced a finding. */
  readonly affected: readonly string[]
}

/**
 * Entities whose document changed, plus entities whose anchors point at a changed file.
 *
 * The second half is the important one: a decision does not have to be edited to become
 * wrong. Its anchor rots when the code it names moves.
 */
export function affectedEntities(
  store: Store,
  changed: readonly string[],
): readonly Entity[] {
  const changedSet = new Set(changed)
  return [...store.byId.values()].filter(
    (entity) =>
      changedSet.has(entity.path) ||
      changed.some((file) => anchoredFiles(entity).some((a) => anchorCovers(a, file))),
  )
}

export function filterSince(
  store: Store,
  findings: readonly Finding[],
  changed: readonly string[],
  ref: string,
): SinceReport {
  const affected = affectedEntities(store, changed)
  const subjects = new Set<string>([
    ...affected.map((e) => e.id),
    // A load problem never reaches `byId`, so it is keyed by path and matched by path.
    ...changed,
  ])

  return {
    ref,
    changed,
    findings: findings.filter((f) => subjects.has(findingSubject(f.where))),
    affected: affected.map((e) => e.id).sort(),
  }
}
