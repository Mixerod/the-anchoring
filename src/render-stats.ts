/**
 * What the corpus costs, measured rather than guessed.
 *
 * Two honesty requirements, stated where the code is rather than only in the plan.
 *
 * **Bytes are measured; tokens are not.** This tool calls no network and no tokenizer —
 * rule 7 — so a token figure here can only ever be arithmetic on a byte count. It is printed
 * with the word "estimate" and with its divisor shown, so a reader can check the arithmetic
 * and knows not to trust the third digit. A confident token count derived from nothing would
 * be indistinguishable from a real one, which is exactly the over-claiming the discipline
 * rules exist to prevent.
 *
 * **"Corpus" means all of it.** The brief carries doctrine, active invariants, accepted
 * decisions, live flows, active hazards and open work — not incidents, not retired documents,
 * not closed work. Reporting only the bundled part under the word "corpus" would understate
 * the repository by every byte it chose to leave out, so what is excluded is counted and
 * named on its own line.
 *
 * Pure module.
 */

import { ENTITY_KINDS, type EntityKind } from './model.js'
import { renderTierBody, byteLength } from './render-brief.js'
import type { Brief, BriefInput, TierLevel } from './brief.js'

/**
 * Bytes per token, approximately, for English prose in a BPE tokenizer. A rule of thumb and
 * nothing more — which is why the divisor is printed alongside every figure derived from it.
 */
export const BYTES_PER_TOKEN_ESTIMATE = 4

export interface KindBytes {
  readonly kind: EntityKind
  readonly bytes: number
  readonly count: number
}

export interface CorpusStats {
  /** Every entity and doctrine file, whether the brief carries it or not. */
  readonly totalBytes: number
  /** Document content the brief carries, excluding its own framing. */
  readonly briefBytes: number
  /** The tier and document markers the renderer adds. Not corpus content. */
  readonly frameBytes: number
  readonly tiers: readonly { readonly level: TierLevel; readonly bytes: number }[]
  readonly kinds: readonly KindBytes[]
  /** AGENTS.md and doctrine: tier-1 files that are not entities. */
  readonly fileBytes: number
  readonly fileCount: number
  /** Documents the brief leaves out: incidents, retired, superseded, closed work. */
  readonly excludedBytes: number
  readonly excludedCount: number
}

export function corpusStats(brief: Brief, input: BriefInput): CorpusStats {
  const bundled = new Set(brief.tiers.flatMap((t) => t.documents.map((d) => d.id)))
  const renderedBytes = brief.tiers.reduce((n, t) => n + byteLength(renderTierBody(t, brief)), 0)

  const fileBytes =
    (input.agents ? byteLength(input.agents.body) : 0) +
    input.doctrine.reduce((n, d) => n + byteLength(d.body), 0)
  const entityBytes = input.entities.reduce((n, e) => n + byteLength(e.body), 0)
  const excluded = input.entities.filter((e) => !bundled.has(e.entity.id))

  // AGENTS.md and doctrine are tier 1, so they count as bundled. Leaving them out made
  // `brief + not-in-the-brief` fall short of `corpus` by exactly their size.
  const bundledBytes =
    fileBytes +
    input.entities
      .filter((e) => bundled.has(e.entity.id))
      .reduce((n, e) => n + byteLength(e.body), 0)

  return {
    totalBytes: fileBytes + entityBytes,
    briefBytes: bundledBytes,
    // Kept apart so `corpus = brief + not-in-the-brief` adds up. Folding the markers into
    // the brief figure made it exceed the corpus on a small repository while reporting
    // nothing excluded - arithmetic that is correct and reads as nonsense.
    frameBytes: renderedBytes - bundledBytes,
    tiers: brief.tiers.map((tier) => ({
      level: tier.level,
      bytes: byteLength(renderTierBody(tier, brief)),
    })),
    kinds: ENTITY_KINDS.map((kind) => {
      const matching = input.entities.filter((e) => e.entity.kind === kind)
      return {
        kind,
        bytes: matching.reduce((n, e) => n + byteLength(e.body), 0),
        count: matching.length,
      }
    }),
    fileBytes,
    fileCount: input.doctrine.length + (input.agents ? 1 : 0),
    excludedBytes: excluded.reduce((n, e) => n + byteLength(e.body), 0),
    excludedCount: excluded.length,
  }
}

const thousands = (n: number): string => n.toLocaleString('en-US')

/**
 * Byte counts first, because they are the measurement. The token line comes last, labelled,
 * with its divisor, because it is arithmetic on the line above it and nothing more.
 */
export function renderStats(stats: CorpusStats): string {
  const perTier = stats.tiers.map((t) => `tier${t.level} ${thousands(t.bytes)}`).join(' · ')
  const perKind = stats.kinds
    .filter((k) => k.count > 0)
    .map((k) => `${k.kind} ${thousands(k.bytes)}`)
    .join(' · ')
  const tokens = Math.round(stats.totalBytes / BYTES_PER_TOKEN_ESTIMATE)

  return [
    `corpus: ${thousands(stats.totalBytes)} bytes  ` +
      `(${thousands(stats.fileBytes)} in ${stats.fileCount} doctrine/agent file(s), rest entities)`,
    `        by kind: ${perKind}`,
    `        brief:   ${thousands(stats.briefBytes)} bytes of documents` +
      ` + ${thousands(stats.frameBytes)} of markers  (${perTier})`,
    `        not in the brief: ${thousands(stats.excludedBytes)} bytes in ` +
      `${stats.excludedCount} document(s) — incidents, retired, superseded, closed work`,
    `        ~ ${thousands(tokens)} tokens (estimate, bytes/${BYTES_PER_TOKEN_ESTIMATE};` +
      ` this tool runs no tokenizer — verify with your model's)`,
  ].join('\n')
}
