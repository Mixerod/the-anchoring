/**
 * `kb brief` — the cacheable cold-start bundle.
 *
 * Every other command in this tool is sized and ordered for a human reading a terminal.
 * An agent pays for that arrangement on every call. Prompt caching is a *prefix* match with
 * at most four breakpoints, so a bundle arranged most-stable-first and ordered
 * deterministically costs roughly an eighth of one that is not.
 *
 * Hence four tiers, in this order, and no other:
 *
 *   1  AGENTS.md, then doctrine        changes monthly
 *   2  active INV, then accepted ADR   changes weekly
 *   3  live FLOW, then active HAZ      changes daily
 *   4  open WORK, session, counts      changes every call — never cacheable
 *
 * The ordering *is* the feature. A change in tier 3 must not invalidate tiers 1 and 2, and
 * that only holds if nothing volatile leaks upward. Every count, timestamp, SHA and
 * duration therefore lives in tier 4 and nowhere else.
 *
 * What this module does not do: cache. `kb brief` renders from the corpus every time. A memo
 * table here would be mutable shared state in a pure core, which is the thing this
 * repository refuses on principle — see docs/THE_ANCHORING.md.
 *
 * Pure module: no filesystem, no clock, no crypto. Bodies are read by `brief-source.ts`.
 */

import { ENTITY_KINDS, type EntityKind } from './model.js'
import type { Entity } from './store.js'

export type TierLevel = 1 | 2 | 3 | 4

export const TIER_LEVELS: readonly TierLevel[] = [1, 2, 3, 4]

/**
 * Labels are constant strings, deliberately. A label that interpolated anything — a count, a
 * date, a path — would put a moving byte in a stable tier, and every commit would then
 * invalidate the cache from that tier onward, silently and forever.
 */
export const TIER_LABELS: Readonly<Record<TierLevel, string>> = {
  1: 'agent instructions and doctrine',
  2: 'invariants and accepted decisions',
  3: 'live flows and active hazards',
  4: 'open work and session state',
}

export interface BriefDocument {
  /** Stable identity: an entity id, or a repo-relative name for a plain file. */
  readonly id: string
  readonly path: string
  readonly body: string
  /** Absent for AGENTS.md and doctrine, which are files rather than entities. */
  readonly kind?: EntityKind
}

export interface BriefTier {
  readonly level: TierLevel
  readonly label: string
  readonly documents: readonly BriefDocument[]
}

export interface KindCount {
  readonly kind: EntityKind
  readonly count: number
}

export interface Brief {
  readonly tiers: readonly BriefTier[]
  /** Every path that contributed, sorted. Paths are stable; counts are not. */
  readonly generatedFrom: readonly string[]
  /** Tier-4 material only. Never rendered above tier 4. */
  readonly counts: readonly KindCount[]
  readonly entityCount: number
  readonly session?: string
}

export interface BriefFile {
  readonly name: string
  readonly path: string
  readonly body: string
}

export interface BriefEntity {
  readonly entity: Entity
  readonly body: string
}

export interface BriefInput {
  readonly agents?: BriefFile
  readonly doctrine: readonly BriefFile[]
  readonly entities: readonly BriefEntity[]
  readonly session?: string
}

/**
 * Plain codepoint order — **not** `localeCompare`.
 *
 * `localeCompare` consults the runtime's locale, so the same corpus sorts differently on two
 * machines, or on one machine under a different `LANG`. That reorders the bundle, which moves
 * the prefix, which misses the cache — with no error and no visible change in the output. A
 * 10× cost multiplier applied in silence is exactly what this layer exists to prevent.
 */
export function byCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * One newline convention, one byte sequence.
 *
 * A repository cloned on Windows with `core.autocrlf=true` hands us CRLF for the same commit
 * that gives LF on Linux. Rendering those bytes straight through would make the bundle — and
 * so the cache key — depend on the checkout rather than the content. Normalising here is not
 * cosmetic; it is what makes byte-stability a property of the corpus instead of the machine.
 *
 * A BOM goes for the same reason: invisible, and a different prefix.
 */
export function normaliseBody(body: string): string {
  const withoutBom = body.charCodeAt(0) === 0xfeff ? body.slice(1) : body
  const lf = withoutBom.replace(/\r\n?/g, '\n')
  return lf.endsWith('\n') ? lf : `${lf}\n`
}

/** Which entity kinds and statuses belong to a tier, in the order they are emitted. */
interface KindSelector {
  readonly kind: EntityKind
  readonly includes: (status: string) => boolean
}

const isOpenWork = (status: string): boolean => status !== 'done' && status !== 'dropped'

const ENTITY_TIERS: Readonly<Record<2 | 3 | 4, readonly KindSelector[]>> = {
  2: [
    { kind: 'INV', includes: (s) => s === 'active' },
    { kind: 'ADR', includes: (s) => s === 'accepted' },
  ],
  3: [
    { kind: 'FLOW', includes: (s) => s === 'live' },
    { kind: 'HAZ', includes: (s) => s === 'active' },
  ],
  // Open work is defined by exclusion so a project that renames `todo` keeps working.
  4: [{ kind: 'WORK', includes: isOpenWork }],
}

function fileDocument(file: BriefFile): BriefDocument {
  return { id: file.name, path: file.path, body: normaliseBody(file.body) }
}

function entityDocuments(
  entities: readonly BriefEntity[],
  selectors: readonly KindSelector[],
): readonly BriefDocument[] {
  return selectors.flatMap((selector) =>
    entities
      .filter((e) => e.entity.kind === selector.kind && selector.includes(e.entity.status))
      .map((e) => ({
        id: e.entity.id,
        path: e.entity.path,
        body: normaliseBody(e.body),
        kind: e.entity.kind,
      }))
      .sort((a, b) => byCodepoint(a.id, b.id)),
  )
}

function countsByKind(entities: readonly BriefEntity[]): readonly KindCount[] {
  return ENTITY_KINDS.map((kind) => ({
    kind,
    count: entities.filter((e) => e.entity.kind === kind).length,
  }))
}

export function planBrief(input: BriefInput): Brief {
  const tier1 = [
    ...(input.agents ? [fileDocument(input.agents)] : []),
    ...[...input.doctrine]
      .sort((a, b) => byCodepoint(a.name, b.name))
      .map(fileDocument),
  ]

  const tiers: readonly BriefTier[] = [
    { level: 1, label: TIER_LABELS[1], documents: tier1 },
    { level: 2, label: TIER_LABELS[2], documents: entityDocuments(input.entities, ENTITY_TIERS[2]) },
    { level: 3, label: TIER_LABELS[3], documents: entityDocuments(input.entities, ENTITY_TIERS[3]) },
    { level: 4, label: TIER_LABELS[4], documents: entityDocuments(input.entities, ENTITY_TIERS[4]) },
  ]

  return {
    tiers,
    generatedFrom: tiers
      .flatMap((t) => t.documents.map((d) => d.path))
      .sort(byCodepoint),
    counts: countsByKind(input.entities),
    entityCount: input.entities.length,
    ...(input.session !== undefined ? { session: input.session } : {}),
  }
}
