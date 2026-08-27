/**
 * The intent graph schema.
 *
 * Six entity kinds carry the meaning that `codegraph` structurally cannot know:
 * why code exists, whom it serves, who decided it, and how it has broken before.
 * Everything here is declarative on purpose — validation, `kb why`, and the CI gate
 * are all driven by these tables, so adding a field is a one-line change.
 *
 * See docs/adr/0013-knowledge-base-and-retrieval.md and docs/adr/0015-hazards-external-failure-modes.md.
 */

export const ENTITY_KINDS = ['ADR', 'INV', 'FLOW', 'WORK', 'INC', 'HAZ'] as const
export type EntityKind = (typeof ENTITY_KINDS)[number]

/** Where each kind lives, and the id shape it must use. */
export const KIND_SPEC: Readonly<
  Record<EntityKind, { readonly dir: string; readonly idPattern: RegExp; readonly statuses: readonly string[] }>
> = {
  ADR: {
    dir: 'docs/adr',
    idPattern: /^ADR-\d{4}$/,
    statuses: ['proposed', 'accepted', 'superseded', 'void'],
  },
  INV: {
    dir: '.dicebound/invariant',
    idPattern: /^INV-[A-Z0-9-]+$/,
    statuses: ['active', 'retired'],
  },
  FLOW: {
    dir: '.dicebound/flow',
    idPattern: /^FLOW-\d{4}$/,
    statuses: ['draft', 'live', 'retired'],
  },
  WORK: {
    dir: '.dicebound/work',
    idPattern: /^W-\d+$/,
    statuses: ['todo', 'doing', 'review', 'done', 'dropped'],
  },
  INC: {
    dir: '.dicebound/incident',
    idPattern: /^INC-\d{4}$/,
    statuses: ['open', 'fixed', 'wontfix'],
  },
  HAZ: {
    dir: '.dicebound/hazard',
    idPattern: /^HAZ-\d{4}$/,
    statuses: ['active', 'retired'],
  },
}

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
  ADR: ['governs_nothing'],
  INV: [],
  FLOW: [],
  WORK: [],
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

export const HAZARD_OPEN_DAYS = 30

/**
 * A hard ceiling, not a guideline. An unbounded catalogue of things that went wrong
 * elsewhere becomes a graveyard, and nobody reads a graveyard. The 25th hazard has to
 * displace one of the 24 by promoting it to an `INV-` with a real checker.
 */
export const HAZARD_CEILING = 24

/** Human-readable phrasing for `kb why`, so output reads as sentences not field names. */
export const EDGE_PHRASE: Readonly<Record<string, string>> = {
  governs: 'is governed by',
  verified_by: 'is verified by',
  enforced_by: 'enforces',
  holds_for: 'must hold for',
  served_by: 'serves',
  touches: 'was touched by',
}

export function kindOf(id: string): EntityKind | undefined {
  return ENTITY_KINDS.find((k) => KIND_SPEC[k].idPattern.test(id))
}
