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
  WORK: ['owner'],
  INC: [],
  HAZ: ['source', 'observed', 'recorded', 'resolution', 'reason'],
}

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
