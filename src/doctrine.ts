/**
 * Doctrine: engineering knowledge that is not a claim about this repository's code.
 *
 * An invariant says *this must hold here*, and an anchor proves the code it names exists.
 * A doctrine file says *this technique answers that kind of problem*, which is true
 * independently of any repository and therefore anchors to nothing. The two are different
 * kinds of statement and are treated differently everywhere: invariants are returned in
 * full and never ranked, doctrine is ranked and never verified.
 *
 * The field that makes doctrine useful is `when:` — the signal in a situation that says
 * reach for this. A technique's *name* is a poor retrieval key, because the agent that
 * already knows the name did not need to look it up; the agent that needs it is holding a
 * symptom ("a retry could apply the same effect twice") and no name at all. So `when:`
 * outweighs tags, title, and filename combined.
 *
 * A trigger is a hint, not a claim. Nothing checks that a `when:` line is true, in exactly
 * the sense `.anchor/doctrine/tags-are-hints.md` sets out for tags. It is scored, never
 * verified, and must never be cited as evidence.
 *
 * Pure module: no filesystem, no clock. Reading is delegated to infra/loader.ts.
 */

import { fieldOverlap, tokenise } from './tokens.js'

/**
 * Where a doctrine file's body lives, and so what it costs.
 *
 * `brief` puts the whole body in tier 1 of `kb brief` — the most stable and most expensive
 * tier, paid by every agent on every cold start whether or not the task needs it. Reserve it
 * for doctrine that bears on *all* work: how to verify, how to report, where module
 * boundaries go.
 *
 * `index` puts roughly fifty bytes in tier 1 — title, path, triggers — and nothing else. The
 * body is read only when `kb ask` or `kb ctx` names the file. That is the Tier-1 promise this
 * repository makes everywhere else: enough metadata to decide what to read, without reading
 * anything.
 *
 * This is the @skills protocol's tiering applied to prose, and the economics are the same
 * ones: a reference costs nothing until used, and only residency is paid on every message.
 *
 * `brief` is the default because it is what every doctrine file written before this did.
 * A cost mechanism that silently demoted existing documents would change what an agent reads
 * without anyone having decided to.
 */
export const DOCTRINE_RESIDENCIES = ['brief', 'index'] as const
export type DoctrineResidency = (typeof DOCTRINE_RESIDENCIES)[number]

export const DEFAULT_RESIDENCY: DoctrineResidency = 'brief'

export function parseResidency(raw: unknown): DoctrineResidency {
  return DOCTRINE_RESIDENCIES.find((r) => r === raw) ?? DEFAULT_RESIDENCY
}

/**
 * Tier 1 for a doctrine file: what an agent gets without paying for the body.
 *
 * Every field past `path` and `name` is optional, because every doctrine file shipped
 * before this existed has none of them. Such a file still loads and still lists; it simply
 * never outranks one that declared a trigger. A format change that invalidated the corpus
 * would be the drift this repository exists to abolish.
 */
export interface DoctrineSummary {
  readonly path: string
  readonly name: string
  readonly title?: string
  readonly tags?: readonly string[]
  /** Trigger phrases: the situation that calls for this technique. */
  readonly when?: readonly string[]
  /** Absent means `brief`, which is what every file written before this field did. */
  readonly residency?: DoctrineResidency
}

export function residencyOf(doc: DoctrineSummary): DoctrineResidency {
  return doc.residency ?? DEFAULT_RESIDENCY
}

export interface DoctrineMatch {
  readonly doc: DoctrineSummary
  readonly score: number
  /**
   * The single trigger line that scored highest, so the reader can judge the match without
   * opening the file. Absent when the match came from tags or title alone.
   */
  readonly trigger?: string
}

/**
 * Weights: `when` 4, tags 3, title 2, filename 1.
 *
 * The ordering is the argument. `when` is the question being asked, so it leads. Tags rank
 * above the title because a title is written for a reader who already has the concept, and
 * a tag is written for a search. The filename scores at all only so that
 * `caching.md` answers "caching" in a corpus whose author wrote no frontmatter yet.
 */
export const DOCTRINE_WEIGHTS = { when: 4, tags: 3, title: 2, name: 1 } as const

/** Highest-scoring single trigger, and its contribution. Ties break on the earlier line. */
function bestTrigger(
  queryTokens: readonly string[],
  when: readonly string[],
): { readonly score: number; readonly trigger?: string } {
  let best = 0
  let trigger: string | undefined
  for (const phrase of when) {
    const overlap = fieldOverlap(tokenise(phrase), queryTokens)
    if (overlap > best) {
      best = overlap
      trigger = phrase
    }
  }
  return trigger === undefined ? { score: best } : { score: best, trigger }
}

/**
 * Score one doctrine file against a query.
 *
 * Triggers are scored best-of rather than summed: a file listing eight triggers is more
 * useful than one listing two, and summing would punish it for that. Averaging would too.
 * The question is whether *any* trigger fires, and how squarely.
 */
export function scoreDoctrine(
  queryTokens: readonly string[],
  doc: DoctrineSummary,
): DoctrineMatch {
  if (queryTokens.length === 0) return { doc, score: 0 }

  const whenResult = bestTrigger(queryTokens, doc.when ?? [])
  const tagsScore = fieldOverlap((doc.tags ?? []).flatMap(tokenise), queryTokens)
  const titleScore = fieldOverlap(tokenise(doc.title ?? ''), queryTokens)
  const nameScore = fieldOverlap(tokenise(doc.name), queryTokens)

  const score =
    whenResult.score * DOCTRINE_WEIGHTS.when +
    tagsScore * DOCTRINE_WEIGHTS.tags +
    titleScore * DOCTRINE_WEIGHTS.title +
    nameScore * DOCTRINE_WEIGHTS.name

  return whenResult.trigger === undefined
    ? { doc, score }
    : { doc, score, trigger: whenResult.trigger }
}

export interface DoctrineRanking {
  /** Scored above zero, best first; ties break on name for determinism. */
  readonly matched: readonly DoctrineMatch[]
  /**
   * Scored zero. Still returned, still listed by name.
   *
   * Ranking must not hide: a retrieval layer whose rejections are invisible cannot be
   * audited, and the corpus is small enough that naming what did not match costs a line.
   */
  readonly unmatched: readonly DoctrineSummary[]
}

export function rankDoctrine(
  queryTokens: readonly string[],
  docs: readonly DoctrineSummary[],
  limit?: number,
): DoctrineRanking {
  const scored = docs.map((doc) => scoreDoctrine(queryTokens, doc))
  const matched = scored
    .filter((m) => m.score > 0)
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.doc.name.localeCompare(b.doc.name)))
  const unmatched = scored
    .filter((m) => m.score === 0)
    .map((m) => m.doc)
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    matched: limit === undefined ? matched : matched.slice(0, limit),
    unmatched,
  }
}
