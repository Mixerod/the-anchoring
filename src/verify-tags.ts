/**
 * A checker for `tags:`.
 *
 * `tags:` arrived in Layer 4 as hand-maintained metadata with no checker, which made it the
 * one place this project reintroduced the drift it exists to abolish. An anchor is verified;
 * a tag was not. A misspelled tag fails **silently**, by simply never matching anything —
 * retrieval quietly gets worse and no run ever says so.
 *
 * The rule is a closed list and a default, not a judgment:
 *
 * - **Vocabulary declared** in `anchoring.config.json` → a tag outside it is an **error**.
 *   Declaring a vocabulary is a deliberate choice, and enforcing it is what makes declaring
 *   it worth anything.
 * - **No vocabulary** → a tag used exactly once in the whole corpus is a **warning**. A
 *   one-off tag is either a typo or a private note; neither is a shared vocabulary. It is
 *   advisory, so it never fails `--strict` — a build that fails on a vocabulary hint is a
 *   build people bypass, and the checks that matter go with it.
 * - **Shape** (a lowercase slug) is an error in both modes. That is a format rule, not a
 *   judgment, so it does not vary with configuration.
 *
 * Pure module.
 */

import type { Entity, Store } from './store.js'
import type { Finding } from './finding.js'
import type { TagsConfig } from './config.js'

export type { TagsConfig }

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * The declared tags of one entity, or `undefined` when the field is malformed.
 *
 * Malformed is not the same as absent, and the caller needs to tell them apart: the shape
 * error is reported once, by `checkTags`, and the vocabulary pass must not report it again.
 */
export function entityTags(entity: Entity): readonly string[] | undefined {
  const raw = entity.fields['tags']
  if (raw === undefined) return []

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return undefined
    return parsed.every((t) => typeof t === 'string') ? (parsed as string[]) : undefined
  } catch {
    return undefined
  }
}

/** Shape only, per entity. An error in both modes. */
export function checkTags(entity: Entity): readonly Finding[] {
  const raw = entity.fields['tags']
  if (raw === undefined) return []

  const tags = entityTags(entity)
  if (tags === undefined) {
    return [
      {
        severity: 'error',
        where: `${entity.id} · tags`,
        message: `\`${raw}\` must be a list of lowercase slugs`,
        hint: 'tags must be formatted as a YAML list of lowercase slugs, e.g. [foo, bar]',
      },
    ]
  }

  return tags
    .filter((tag) => !SLUG_PATTERN.test(tag))
    .map((tag) => ({
      severity: 'error' as const,
      where: `${entity.id} · tags`,
      message: `\`${tag}\` is not a lowercase slug`,
      hint: 'a tag must contain only lowercase letters, numbers, and hyphens',
    }))
}

/** Tag → the ids that use it, in id order, so every message below is deterministic. */
function tagUsage(store: Store): ReadonlyMap<string, readonly string[]> {
  const usage = new Map<string, string[]>()
  const entities = [...store.byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  for (const entity of entities) {
    for (const tag of entityTags(entity) ?? []) {
      const ids = usage.get(tag)
      if (ids) ids.push(entity.id)
      else usage.set(tag, [entity.id])
    }
  }
  return usage
}

/**
 * The corpus-level pass: vocabulary, or the singleton default.
 *
 * Corpus-level because "used exactly once" is not a fact any single document knows about
 * itself. Findings are emitted in tag order for determinism.
 */
export function checkTagVocabulary(store: Store, tags?: TagsConfig): readonly Finding[] {
  const usage = tagUsage(store)
  const declared = tags?.vocabulary
  const findings: Finding[] = []

  for (const tag of [...usage.keys()].sort()) {
    const users = usage.get(tag) ?? []

    if (declared !== undefined) {
      if (!declared.includes(tag)) {
        findings.push({
          severity: 'error',
          where: `${users[0] ?? '?'} · tags`,
          message: `\`${tag}\` is not in the declared tag vocabulary`,
          hint: `add it to \`tags.vocabulary\` in anchoring.config.json, or use one of: ${declared.join(', ')}`,
        })
      }
      continue
    }

    if (users.length === 1) {
      findings.push({
        severity: 'warn',
        // Advisory: a hint about vocabulary quality, never a reason to fail a build.
        advisory: true,
        where: `${users[0] ?? '?'} · tags`,
        message: `\`${tag}\` is used exactly once in the corpus`,
        hint: 'a one-off tag is either a typo or a private note; neither helps anyone retrieve anything',
      })
    }
  }

  return findings
}
