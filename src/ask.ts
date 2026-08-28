/**
 * `kb ask` — free-text query over the intent graph before a work item exists.
 *
 * Sibling of `kb ctx` and `kb why`. Given a question or topic ("I am about to add a
 * payment webhook — what in this repository bears on that?"), returns:
 * 1. Always, in full: every active invariant (INV-).
 * 2. Always, in full: every active open hazard (HAZ-).
 * 3. Ranked by relevance: decisions (ADR-), user flows (FLOW-), work items (W-),
 *    and incidents (INC-).
 * 4. Doctrine file names and headings from `.anchor/doctrine/` if present.
 *
 * Scoring matches on frontmatter only (id, title, tags) without loading document bodies.
 * Pure module: no filesystem I/O, no crypto, no clock. Rationale: docs/THE_ANCHORING.md.
 */

import { type Entity, type Store } from './store.js'
import { loadStore, loadDoctrine, type DoctrineSummary } from './loader.js'
import type { AnchoringConfig } from './config.js'

export const STOPWORDS = new Set([
  'a',
  'about',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'have',
  'in',
  'is',
  'it',
  'its',
  'not',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'will',
  'with',
])

export function tokenise(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
}

export function extractQueryTokens(query: string): readonly string[] {
  const filtered = tokenise(query)
  if (filtered.length > 0) return filtered
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
}

function entityTagTokens(entity: Entity): readonly string[] {
  const raw = entity.fields['tags']
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.flatMap((item) =>
        String(item)
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((t) => t.length > 0 && !STOPWORDS.has(t)),
      )
    }
  } catch {
    // raw was a bare string rather than JSON
  }
  return tokenise(raw)
}

function fieldOverlap(fieldTokens: readonly string[], queryTokens: readonly string[]): number {
  if (fieldTokens.length === 0 || queryTokens.length === 0) return 0
  let matches = 0
  for (const q of queryTokens) {
    if (fieldTokens.includes(q)) {
      matches += 1
    }
  }
  return matches / fieldTokens.length
}

/**
 * Weighted term overlap length-normalised across frontmatter fields:
 * - tags: weight 3
 * - title: weight 2
 * - id: weight 1
 */
export function scoreEntity(queryTokens: readonly string[], entity: Entity): number {
  if (queryTokens.length === 0) return 0

  const idTokens = entity.id
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
  const titleTokens = tokenise(entity.title)
  const tagsTokens = entityTagTokens(entity)

  const idScore = fieldOverlap(idTokens, queryTokens)
  const titleScore = fieldOverlap(titleTokens, queryTokens)
  const tagsScore = fieldOverlap(tagsTokens, queryTokens)

  return idScore * 1 + titleScore * 2 + tagsScore * 3
}

export interface RankedMatch {
  readonly entity: Entity
  readonly score: number
}

export type { DoctrineSummary }

export const RANKED_KINDS = ['ADR', 'FLOW', 'WORK', 'INC'] as const
export type RankedKind = (typeof RANKED_KINDS)[number]

export const DEFAULT_ASK_LIMIT = 8

export interface AskReport {
  readonly query: string
  readonly corpusSize: number
  readonly invariants: readonly Entity[]
  readonly openHazards: readonly Entity[]
  readonly ranked: Readonly<Record<RankedKind, readonly RankedMatch[]>>
  readonly totalMatches: number
  readonly doctrine: readonly DoctrineSummary[]
}

export interface AskOptions {
  readonly limit?: number
  readonly doctrine?: readonly DoctrineSummary[]
}

export function askStore(
  store: Store,
  query: string,
  options: AskOptions = {},
): AskReport {
  const queryTokens = extractQueryTokens(query)
  const limit = options.limit ?? DEFAULT_ASK_LIMIT
  const allEntities = [...store.byId.values()]

  // 1. Invariants: always, in full, sorted by id ascending
  const invariants = allEntities
    .filter((e) => e.kind === 'INV' && e.status === 'active')
    .sort((a, b) => a.id.localeCompare(b.id))

  // 2. Open Hazards: always, in full, sorted by id ascending
  const openHazards = allEntities
    .filter((e) => e.kind === 'HAZ' && e.status === 'active' && e.fields['resolution'] === 'open')
    .sort((a, b) => a.id.localeCompare(b.id))

  // 3. Ranked matches for ADR, FLOW, WORK, INC
  let totalMatches = 0
  const ranked: Record<RankedKind, readonly RankedMatch[]> = {
    ADR: [],
    FLOW: [],
    WORK: [],
    INC: [],
  }

  for (const kind of RANKED_KINDS) {
    const candidates = allEntities.filter((e) => e.kind === kind)
    const scored: RankedMatch[] = []

    for (const entity of candidates) {
      const score = scoreEntity(queryTokens, entity)
      if (score > 0) {
        scored.push({ entity, score })
      }
    }

    // Ties break by id ascending for determinism
    scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.entity.id.localeCompare(b.entity.id)))
    totalMatches += scored.length
    ranked[kind] = scored.slice(0, limit)
  }

  return {
    query,
    corpusSize: allEntities.length,
    invariants,
    openHazards,
    ranked,
    totalMatches,
    doctrine: options.doctrine ?? [],
  }
}

export function ask(
  config: AnchoringConfig,
  query: string,
  options: AskOptions = {},
): AskReport {
  const store = loadStore(config)
  const doctrine = options.doctrine ?? loadDoctrine(config)
  return askStore(store, query, { ...options, doctrine })
}
