/**
 * The configuration shape, and the defaults a repository gets before `anchoring.config.json`
 * says anything.
 *
 * Split from `config.ts` when that file reached its own 400-line limit. The two halves change
 * for different reasons — a shape and its defaults move when the tool's opinion changes, a
 * parser moves when the file format does — which is the split rule this repository states
 * and, until now, had not applied to itself.
 *
 * The types live here rather than in `config.ts` because the defaults need them and
 * `config.ts` needs the defaults: leaving them behind made a cycle, which `depcruise` caught
 * within one run.
 *
 * Pure module: no filesystem, no clock. `config.ts` re-exports everything here, so nothing
 * outside had to learn a second import path.
 */

import { ENTITY_KINDS, type EntityKind } from './model.js'
import type { Architecture } from './config-architecture.js'

/**
 * Optional closed vocabulary for `tags:`.
 *
 * Declared here rather than beside its checker because `AnchoringConfig` must not import a
 * checker: `verify-tags.ts` reads the store, the store reads the config, and a type import
 * the other way closes the loop. `depcruise` caught it, which is the whole reason the
 * no-circular rule exists.
 */
export interface TagsConfig {
  readonly vocabulary?: readonly string[]
}

export interface KindSpec {
  readonly dir: string                      // repo-relative, forward slashes
  readonly idPattern: RegExp
  readonly statuses: readonly string[]
}

export interface AnchoringConfig {
  readonly root: string                     // absolute repository root
  readonly kbRoot: string                   // repo-relative
  readonly kinds: Readonly<Record<EntityKind, KindSpec>>
  readonly governedPaths: readonly string[]
  readonly hazard: { readonly openDays: number; readonly ceiling: number }
  readonly symbolIndex: 'codegraph' | 'none'
  /** Warn above this many UTF-8 bytes of entity body. Never an error — see checkBodyBudget. */
  readonly maxBodyBytes: number
  /**
   * Warn above this many UTF-8 bytes of *resident* doctrine — tier 1 of `kb brief`, which
   * every agent pays on every cold start. Advisory, never an error.
   */
  readonly maxResidentDoctrineBytes: number
  /**
   * Optional closed vocabulary for `tags:`. Absent means the singleton default applies.
   * See verify-tags.ts for why the two modes differ in severity.
   */
  readonly tags?: TagsConfig
  readonly sessionFile: string              // derived: `${kbRoot}/session/current`
  readonly architecture?: Architecture
}


export const DEFAULT_KB_ROOT = '.anchor'

export const DEFAULT_KINDS: Readonly<
  Record<
    EntityKind,
    {
      readonly dir: (kbRoot: string) => string
      readonly idPattern: RegExp
      readonly statuses: readonly string[]
    }
  >
> = {
  ADR: {
    dir: () => 'docs/adr',
    idPattern: /^ADR-\d{4}$/,
    statuses: ['proposed', 'accepted', 'superseded', 'void'],
  },
  INV: {
    dir: (kbRoot) => `${kbRoot}/invariant`,
    idPattern: /^INV-[A-Z0-9-]+$/,
    statuses: ['active', 'retired'],
  },
  FLOW: {
    dir: (kbRoot) => `${kbRoot}/flow`,
    idPattern: /^FLOW-\d{4}$/,
    statuses: ['draft', 'live', 'retired'],
  },
  WORK: {
    dir: (kbRoot) => `${kbRoot}/work`,
    idPattern: /^W-\d+$/,
    statuses: ['todo', 'doing', 'review', 'done', 'dropped'],
  },
  INC: {
    dir: (kbRoot) => `${kbRoot}/incident`,
    idPattern: /^INC-\d{4}$/,
    statuses: ['open', 'fixed', 'wontfix'],
  },
  HAZ: {
    dir: (kbRoot) => `${kbRoot}/hazard`,
    idPattern: /^HAZ-\d{4}$/,
    statuses: ['active', 'retired'],
  },
}

export const DEFAULT_GOVERNED_PATHS: readonly string[] = [
  'src/',
  'packages/',
  'apps/',
  'lib/',
  'scripts/',
]

export const DEFAULT_HAZARD = {
  openDays: 30,
  ceiling: 24,
}

export const DEFAULT_SYMBOL_INDEX: 'codegraph' | 'none' = 'codegraph'

/**
 * Entity bodies are the bulk of the corpus and nothing else bounds them. `src/` has
 * `maxFileLines`; a doctrine file may grow to any size, and every agent pays for it on every
 * cold start, forever.
 */
export const DEFAULT_MAX_BODY_BYTES = 6000

/**
 * The tier-1 doctrine ceiling: ~4,000 tokens at four bytes per token.
 *
 * Chosen against the measured corpus rather than a feeling. The six `discipline` doctrine
 * files plus AGENTS.md came to 13,887 bytes, so the budget leaves genuine room to add
 * doctrine that bears on all work, and starts complaining well before an engineering
 * knowledge corpus could be resident by accident — which is the specific failure it exists
 * to catch, since `residency: brief` is the default and a pack author who omits the field
 * gets it.
 */
export const DEFAULT_MAX_RESIDENT_DOCTRINE_BYTES = 16000

export function defaultKinds(kbRoot: string): Record<EntityKind, KindSpec> {
  const kinds = {} as Record<EntityKind, KindSpec>
  for (const k of ENTITY_KINDS) {
    const spec = DEFAULT_KINDS[k]
    kinds[k] = {
      dir: spec.dir(kbRoot),
      idPattern: spec.idPattern,
      statuses: spec.statuses,
    }
  }
  return kinds
}

export function defaultConfig(root: string): AnchoringConfig {
  const kbRoot = DEFAULT_KB_ROOT
  return {
    root,
    kbRoot,
    kinds: defaultKinds(kbRoot),
    governedPaths: DEFAULT_GOVERNED_PATHS,
    hazard: DEFAULT_HAZARD,
    symbolIndex: DEFAULT_SYMBOL_INDEX,
    maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
    maxResidentDoctrineBytes: DEFAULT_MAX_RESIDENT_DOCTRINE_BYTES,
    sessionFile: `${kbRoot}/session/current`,
  }
}

