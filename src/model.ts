/**
 * The intent graph schema.
 *
 * Six entity kinds carry the meaning that `codegraph` structurally cannot know:
 * why code exists, whom it serves, who decided it, and how it has broken before.
 * Everything here is declarative on purpose — validation, `kb why`, and the CI gate
 * are all driven by these tables, so adding a field is a one-line change.
 *
 * See docs/THE_ANCHORING.md.
 */

export const ENTITY_KINDS = ['ADR', 'INV', 'FLOW', 'WORK', 'INC', 'HAZ'] as const
export type EntityKind = (typeof ENTITY_KINDS)[number]

/**
 * A link field either points at other entities (`to`) or at code (`anchor`).
 * Anchors are the bridge to codegraph; entity refs are the intent graph's own edges.
 */
export type LinkField =
  | { readonly kind: 'anchor' }
  | { readonly kind: 'ref'; readonly to: readonly EntityKind[] }

export const LINK_FIELDS: Readonly<Record<EntityKind, Readonly<Record<string, LinkField>>>> = {
  ADR: {
    governs: { kind: 'anchor' },
    constrains: { kind: 'ref', to: ['INV'] },
    verified_by: { kind: 'anchor' },
    supersedes: { kind: 'ref', to: ['ADR'] },
  },
  INV: {
    enforced_by: { kind: 'anchor' },
    holds_for: { kind: 'anchor' },
  },
  FLOW: {
    served_by: { kind: 'anchor' },
    decided_by: { kind: 'ref', to: ['ADR'] },
  },
  WORK: {
    implements: { kind: 'ref', to: ['ADR', 'FLOW'] },
    touches: { kind: 'anchor' },
    closes: { kind: 'ref', to: ['INC'] },
    blocked_by: { kind: 'ref', to: ['WORK'] },
  },
  HAZ: {
    holds_for: { kind: 'anchor' },
    resolves_to: { kind: 'ref', to: ['INV'] },
  },
  INC: {
    violates: { kind: 'ref', to: ['INV'] },
    found_in: { kind: 'ref', to: ['WORK'] },
    closed_by: { kind: 'ref', to: ['WORK'] },
    touches: { kind: 'anchor' },
    promoted_to: { kind: 'ref', to: ['ADR'] },
  },
}

/**
 * Frontmatter values that are neither links nor the three fields every kind has.
 *
 * Only `HAZ` needs any today. They are declared here rather than special-cased in the
 * loader for the same reason the tables above exist: adding a field stays a one-line
 * change, and `store.ts` never learns what a hazard is.
 */
export const SCALAR_FIELDS: Readonly<Record<EntityKind, readonly string[]>> = {
  ADR: ['governs_nothing', 'owner'],
  INV: ['owner'],
  FLOW: [],
  /**
   * `executed_by` is a free string with no shape constraint, on purpose.
   *
   * The first adopter carried `owner:` on all 70 of its work items with values like
   * `claude`, `agent`, `antigravity` — none of them a person, all of them rejected by the
   * `@handle` / `team:<name>` check. The field never meant ownership in the CODEOWNERS
   * sense: it recorded *which agent executed the work*. Two concepts wearing one name,
   * found by a validator rather than by a reader.
   *
   * The fix is a second field, not a looser first one. `owner` still identifies a person
   * or a team and still has a shape, because an ownership field that accepts anything
   * identifies nobody. `executed_by` names a tool, and constraining it to a handle shape
   * would repeat the same mistake in the other direction.
   */
  WORK: ['owner', 'executed_by'],
  INC: [
    'upstream',
    'upstream_verdict',
    'upstream_evidence',
    'upstream_gate',
    'upstream_rejected',
    'upstream_recorded',
    'upstream_work',
  ],
  HAZ: ['source', 'observed', 'recorded', 'resolution', 'reason'],
}

/**
 * How an incident may be attributed to a package other than this repository.
 *
 * **This list is closed, and the closedness is the mechanism, not an implementation
 * detail.** Attribution's failure mode is over-attribution: an agent asked "is this the
 * tool's fault?" says yes far more often than the truth warrants, and a classifier that
 * can never say `no` reports noise until somebody switches it off. A fixed set of classes,
 * each with a requirement `kb verify` can check, is what stops the judgment drifting; the
 * default verdict is `local` and stays `local` until one of these four actually applies.
 *
 * A fifth class MUST NOT be added without a new ADR arguing why the four were
 * insufficient. See docs/THE_ANCHORING.md, "The upstream loop".
 *
 * - `silent-gate`        a gate ran and stayed silent when it should have spoken
 * - `generated-artifact` the defect is in a file the tool generated
 * - `shipped-invariant`  a shipped invariant was wrong or insufficient
 * - `schema-gap`         the schema cannot express what had to be expressed
 */
export const EVIDENCE_CLASSES = [
  'silent-gate',
  'generated-artifact',
  'shipped-invariant',
  'schema-gap',
] as const
export type EvidenceClass = (typeof EVIDENCE_CLASSES)[number]

/** The four commands, and so the four gates a `silent-gate` incident may name. */
export const UPSTREAM_GATES = ['verify', 'done', 'guards', 'owners'] as const
export type UpstreamGate = (typeof UPSTREAM_GATES)[number]

/** `local` is the default and requires nothing. Only the other two carry obligations. */
export const UPSTREAM_VERDICTS = ['local', 'upstream', 'unclear'] as const
export type UpstreamVerdict = (typeof UPSTREAM_VERDICTS)[number]

/** The five invariants `kb init --guards` ships. `shipped-invariant` must name one. */
export const SHIPPED_INVARIANTS = [
  'INV-NO-CYCLES',
  'INV-DEP-DIRECTION',
  'INV-MODULE-ENTRY',
  'INV-PURE-CORE',
  'INV-FILE-SIZE',
] as const

/**
 * A loop nobody closed must make noise, for the same reason an unread hazard must: an
 * unread `UP-` is worse than none. Past this many days without an `upstream_work`, an
 * escalated incident warns, and `--strict` turns that into a failed build.
 */
export const UPSTREAM_OPEN_DAYS = 60

/**
 * An unbounded backlog of other-people's-bugs is a graveyard — the same argument as the
 * hazard ceiling. The 13th escalation must close one first.
 */
export const UPSTREAM_CEILING = 12

/**
 * What a hazard's author has decided to do about it.
 *
 * `open` is the only one that is not a decision, which is why it is the only one on a
 * clock: past HAZARD_OPEN_DAYS it becomes a warning, and `--strict` turns that into a
 * failed build. That escalation is the mechanism that converts a war story into a checker.
 */
export const HAZARD_RESOLUTIONS = ['guarded', 'accepted', 'not-applicable', 'open'] as const
export type HazardResolution = (typeof HAZARD_RESOLUTIONS)[number]

/** Human-readable phrasing for `kb why`, so output reads as sentences not field names. */
export const EDGE_PHRASE: Readonly<Record<string, string>> = {
  governs: 'is governed by',
  verified_by: 'is verified by',
  enforced_by: 'enforces',
  holds_for: 'must hold for',
  served_by: 'serves',
  touches: 'was touched by',
}

export interface KindPatternLookup {
  readonly kinds: Readonly<Record<EntityKind, { readonly idPattern: RegExp }>>
}

export function kindOf(lookup: KindPatternLookup, id: string): EntityKind | undefined {
  return ENTITY_KINDS.find((k) => lookup.kinds[k].idPattern.test(id))
}
