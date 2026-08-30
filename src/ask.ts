/**
 * `kb ask` — free-text query over the intent graph before a work item exists.
 *
 * Sibling of `kb ctx` and `kb why`. Given a question or topic ("I am about to add a
 * payment webhook — what in this repository bears on that?"), returns:
 * 1. Always, in full: every active invariant (INV-).
 * 2. Always, in full: every active open hazard (HAZ-).
 * 3. Ranked by relevance: decisions (ADR-), user flows (FLOW-), work items (W-),
 *    and incidents (INC-).
 * 4. Doctrine from `.anchor/doctrine/`, ranked by its `when:` triggers, with the trigger
 *    line that matched. Unmatched doctrine is still named — ranking must not hide.
 *
 * Scoring matches on frontmatter only (id, title, tags) without loading document bodies.
 * Pure module: no filesystem I/O, no crypto, no clock. Rationale: docs/THE_ANCHORING.md.
 */

import { type Entity, type Store } from './store.js'
import type { EntityKind } from './model.js'
import { loadStore, loadDoctrine } from './loader.js'
import type { AnchoringConfig } from './config.js'
import {
  extractQueryTokens,
  fieldOverlap,
  listTokens,
  tokenise,
} from './tokens.js'
import {
  rankDoctrine,
  type DoctrineMatch,
  type DoctrineRanking,
  type DoctrineSummary,
} from './doctrine.js'

/**
 * Re-exported because they were part of this module's surface before `tokens.ts` existed.
 * The implementation moved; the API did not.
 */
export { STOPWORDS, tokenise, extractQueryTokens } from './tokens.js'

function entityTagTokens(entity: Entity): readonly string[] {
  return listTokens(entity.fields['tags'])
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

export type { DoctrineSummary, DoctrineMatch, DoctrineRanking }

export const RANKED_KINDS = ['ADR', 'FLOW', 'WORK', 'INC'] as const
export type RankedKind = (typeof RANKED_KINDS)[number]

export const DEFAULT_ASK_LIMIT = 8

export interface HazardExclusion {
  readonly resolution: string
  readonly count: number
}

/**
 * What the query did **not** return, and why.
 *
 * A filter whose rejections are invisible cannot be audited, and an unauditable filter is
 * trusted right up until it is ignored. Counts and reasons only — never the excluded
 * entities themselves, which would reintroduce exactly the token cost Layer 5 exists to
 * remove.
 */
export interface AskExclusions {
  /** Entities the ranker actually scored. */
  readonly searched: number
  readonly scoredZero: number
  /** Matches dropped by `--limit`: found, ranked, and then not shown. */
  readonly truncated: number
  /** Active hazards held back because their author already decided what to do. */
  readonly hazards: readonly HazardExclusion[]
  readonly retiredInvariants: number
  readonly supersededDecisions: number
  /** Returned in full rather than ranked, so never scored against the query. */
  readonly alwaysReturned: readonly EntityKind[]
}

export interface AskReport {
  readonly query: string
  readonly corpusSize: number
  readonly invariants: readonly Entity[]
  readonly openHazards: readonly Entity[]
  readonly ranked: Readonly<Record<RankedKind, readonly RankedMatch[]>>
  readonly totalMatches: number
  readonly doctrine: DoctrineRanking
  readonly exclusions: AskExclusions
}

export interface AskOptions {
  readonly limit?: number
  readonly doctrine?: readonly DoctrineSummary[]
}

/**
 * Doctrine is capped tighter than entities, and deliberately.
 *
 * An entity match is a fact about this repository the agent may need; a doctrine match is a
 * technique it may reach for, and a list of twelve techniques is a research project, not
 * guidance. Three is what fits in the space between reading the query and starting work.
 */
export const DEFAULT_DOCTRINE_LIMIT = 3

/**
 * A decision that has been replaced is not guidance, so it is not ranked.
 *
 * Note what this does *not* touch: invariants and open hazards are still returned in full,
 * every time. An invariant that applies only when a keyword matches is not an invariant, and
 * an unread hazard is worse than none — which is why there is a clock on them. The
 * temptation, once exclusion counts exist, is to start trimming those too.
 */
const isRankable = (entity: Entity): boolean =>
  !(entity.kind === 'ADR' && (entity.status === 'superseded' || entity.status === 'void'))

function hazardExclusions(entities: readonly Entity[]): readonly HazardExclusion[] {
  const counts = new Map<string, number>()
  for (const e of entities) {
    if (e.kind !== 'HAZ' || e.status !== 'active') continue
    const resolution = e.fields['resolution'] ?? 'unrecorded'
    if (resolution === 'open') continue
    counts.set(resolution, (counts.get(resolution) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([resolution, count]) => ({ resolution, count }))
    .sort((a, b) => (a.resolution < b.resolution ? -1 : a.resolution > b.resolution ? 1 : 0))
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
  let searched = 0
  let truncated = 0
  const ranked: Record<RankedKind, readonly RankedMatch[]> = {
    ADR: [],
    FLOW: [],
    WORK: [],
    INC: [],
  }

  for (const kind of RANKED_KINDS) {
    const candidates = allEntities.filter((e) => e.kind === kind && isRankable(e))
    searched += candidates.length
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
    truncated += Math.max(0, scored.length - limit)
  }

  return {
    query,
    corpusSize: allEntities.length,
    invariants,
    openHazards,
    ranked,
    totalMatches,
    doctrine: rankDoctrine(queryTokens, options.doctrine ?? [], DEFAULT_DOCTRINE_LIMIT),
    exclusions: {
      searched,
      scoredZero: searched - totalMatches,
      truncated,
      hazards: hazardExclusions(allEntities),
      retiredInvariants: allEntities.filter((e) => e.kind === 'INV' && e.status !== 'active').length,
      supersededDecisions: allEntities.filter((e) => e.kind === 'ADR' && !isRankable(e)).length,
      alwaysReturned: ['INV', 'HAZ'],
    },
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
