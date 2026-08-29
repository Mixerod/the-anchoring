/**
 * Configuration layer for the intent graph.
 *
 * Paths, id patterns, statuses, hazard thresholds, and architecture matrices are configurable
 * via `anchoring.config.json` at the repository root. The schema itself (the six entity
 * kinds, link fields, and edge semantics) is intentionally hardcoded in model.ts.
 */

import { ENTITY_KINDS, type EntityKind } from './model.js'
import {
  type Layer,
  type Architecture,
  parseArchitecture,
  isInvalidPosixRelPath,
  DEFAULT_ENTRY_POINTS,
  DEFAULT_MAX_FILE_LINES,
  DEFAULT_MAX_FUNCTION_LINES,
  DEFAULT_IMPURE_IMPORTS,
  DEFAULT_IO_MESSAGE,
} from './config-architecture.js'

export type { Layer, Architecture }
export {
  DEFAULT_ENTRY_POINTS,
  DEFAULT_MAX_FILE_LINES,
  DEFAULT_MAX_FUNCTION_LINES,
  DEFAULT_IMPURE_IMPORTS,
  DEFAULT_IO_MESSAGE,
}

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

function defaultKinds(kbRoot: string): Record<EntityKind, KindSpec> {
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
    sessionFile: `${kbRoot}/session/current`,
  }
}

const KNOWN_TOP_KEYS = [
  'kbRoot',
  'kinds',
  'governedPaths',
  'hazard',
  'symbolIndex',
  'maxBodyBytes',
  'tags',
  'architecture',
] as const
const KNOWN_TAGS_KEYS = ['vocabulary'] as const
const KNOWN_KIND_KEYS = ['dir', 'idPattern', 'statuses'] as const
const KNOWN_HAZARD_KEYS = ['openDays', 'ceiling'] as const

export type ConfigProblems = readonly string[]
export type ConfigResult =
  | { readonly ok: true; readonly config: AnchoringConfig }
  | { readonly ok: false; readonly problems: ConfigProblems }

/**
 * Declaring an *empty* vocabulary is rejected rather than silently accepted.
 *
 * It would otherwise read as "no vocabulary" while meaning "every tag is an error" — two
 * opposite behaviours one keystroke apart, with nothing to tell them apart at a glance.
 */
function parseTags(raw: unknown, problems: string[]): TagsConfig | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push('`tags` must be an object')
    return undefined
  }

  const rawTags = raw as Record<string, unknown>
  for (const key of Object.keys(rawTags)) {
    if (!KNOWN_TAGS_KEYS.includes(key as (typeof KNOWN_TAGS_KEYS)[number])) {
      problems.push(
        `unknown key \`${key}\` under \`tags\`; accepted keys are: ${KNOWN_TAGS_KEYS.join(', ')}`,
      )
    }
  }

  if (rawTags['vocabulary'] === undefined) return {}

  const vocabulary = rawTags['vocabulary']
  if (
    !Array.isArray(vocabulary) ||
    vocabulary.length === 0 ||
    vocabulary.some((t: unknown) => typeof t !== 'string' || t.trim() === '')
  ) {
    problems.push('`tags.vocabulary` must be a non-empty array of non-empty strings')
    return undefined
  }

  return { vocabulary: vocabulary as readonly string[] }
}

export function parseConfig(root: string, raw: unknown): ConfigResult {
  const problems: string[] = []

  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, problems: ['top level must be an object'] }
  }

  const rawObj = raw as Record<string, unknown>

  for (const key of Object.keys(rawObj)) {
    if (!KNOWN_TOP_KEYS.includes(key as (typeof KNOWN_TOP_KEYS)[number])) {
      problems.push(
        `unknown top-level key \`${key}\`; accepted keys are: ${KNOWN_TOP_KEYS.join(', ')}`,
      )
    }
  }

  let kbRoot = DEFAULT_KB_ROOT
  if (rawObj['kbRoot'] !== undefined) {
    if (typeof rawObj['kbRoot'] !== 'string' || rawObj['kbRoot'].trim() === '') {
      problems.push('`kbRoot` must be a non-empty string')
    } else if (isInvalidPosixRelPath(rawObj['kbRoot'])) {
      problems.push(
        `\`kbRoot\` \`${rawObj['kbRoot']}\` must be a repo-relative POSIX path (cannot be absolute, contain \`..\`, or contain backslashes)`,
      )
    } else {
      kbRoot = rawObj['kbRoot']
    }
  }

  const kinds = defaultKinds(kbRoot)

  if (rawObj['kinds'] !== undefined) {
    if (
      typeof rawObj['kinds'] !== 'object' ||
      rawObj['kinds'] === null ||
      Array.isArray(rawObj['kinds'])
    ) {
      problems.push('`kinds` must be an object')
    } else {
      const rawKinds = rawObj['kinds'] as Record<string, unknown>
      for (const kindKey of Object.keys(rawKinds)) {
        if (!ENTITY_KINDS.includes(kindKey as EntityKind)) {
          problems.push(
            `unknown key \`${kindKey}\` under \`kinds\`; accepted kinds are: ${ENTITY_KINDS.join(', ')}`,
          )
        }
      }

      for (const kind of ENTITY_KINDS) {
        const defaultSpec = DEFAULT_KINDS[kind]
        const rawSpec = rawKinds[kind]
        if (rawSpec === undefined) continue

        if (typeof rawSpec !== 'object' || rawSpec === null || Array.isArray(rawSpec)) {
          problems.push(`kinds.${kind} must be an object`)
          continue
        }

        const rawSpecObj = rawSpec as Record<string, unknown>
        for (const k of Object.keys(rawSpecObj)) {
          if (!KNOWN_KIND_KEYS.includes(k as (typeof KNOWN_KIND_KEYS)[number])) {
            problems.push(
              `unknown key \`${k}\` under kinds.${kind}; accepted keys are: ${KNOWN_KIND_KEYS.join(', ')}`,
            )
          }
        }

        let dir = defaultSpec.dir(kbRoot)
        if (rawSpecObj['dir'] !== undefined) {
          if (typeof rawSpecObj['dir'] !== 'string' || rawSpecObj['dir'].trim() === '') {
            problems.push(`kinds.${kind}.dir must be a non-empty string`)
          } else if (isInvalidPosixRelPath(rawSpecObj['dir'])) {
            problems.push(
              `kinds.${kind}.dir \`${rawSpecObj['dir']}\` must be a repo-relative POSIX path (cannot be absolute, contain \`..\`, or contain backslashes)`,
            )
          } else {
            dir = rawSpecObj['dir']
          }
        }

        let idPattern = defaultSpec.idPattern
        if (rawSpecObj['idPattern'] !== undefined) {
          if (
            typeof rawSpecObj['idPattern'] !== 'string' ||
            !rawSpecObj['idPattern'].startsWith('^') ||
            !rawSpecObj['idPattern'].endsWith('$')
          ) {
            problems.push(
              `kinds.${kind}.idPattern must be a string starting with \`^\` and ending with \`$\``,
            )
          } else {
            try {
              idPattern = new RegExp(rawSpecObj['idPattern'])
            } catch (err) {
              problems.push(
                `kinds.${kind}.idPattern \`${rawSpecObj['idPattern']}\` is not a valid regular expression: ${(err as Error).message}`,
              )
            }
          }
        }

        let statuses = defaultSpec.statuses
        if (rawSpecObj['statuses'] !== undefined) {
          if (
            !Array.isArray(rawSpecObj['statuses']) ||
            rawSpecObj['statuses'].length === 0 ||
            rawSpecObj['statuses'].some(
              (s: unknown) => typeof s !== 'string' || s.trim() === '',
            )
          ) {
            problems.push(
              `kinds.${kind}.statuses must be a non-empty array of non-empty strings`,
            )
          } else {
            statuses = rawSpecObj['statuses'] as readonly string[]
          }
        }

        kinds[kind] = { dir, idPattern, statuses }
      }
    }
  }

  let governedPaths = DEFAULT_GOVERNED_PATHS
  if (rawObj['governedPaths'] !== undefined) {
    if (
      !Array.isArray(rawObj['governedPaths']) ||
      rawObj['governedPaths'].length === 0 ||
      rawObj['governedPaths'].some(
        (p: unknown) => typeof p !== 'string' || p.trim() === '',
      )
    ) {
      problems.push('`governedPaths` must be an array of non-empty strings')
    } else {
      governedPaths = (rawObj['governedPaths'] as readonly string[]).map((p) =>
        p.endsWith('/') ? p : `${p}/`,
      )
    }
  }

  let hazard = DEFAULT_HAZARD
  if (rawObj['hazard'] !== undefined) {
    if (
      typeof rawObj['hazard'] !== 'object' ||
      rawObj['hazard'] === null ||
      Array.isArray(rawObj['hazard'])
    ) {
      problems.push('`hazard` must be an object')
    } else {
      const rawHazard = rawObj['hazard'] as Record<string, unknown>
      for (const k of Object.keys(rawHazard)) {
        if (!KNOWN_HAZARD_KEYS.includes(k as (typeof KNOWN_HAZARD_KEYS)[number])) {
          problems.push(
            `unknown key \`${k}\` under \`hazard\`; accepted keys are: ${KNOWN_HAZARD_KEYS.join(', ')}`,
          )
        }
      }

      let openDays = DEFAULT_HAZARD.openDays
      if (rawHazard['openDays'] !== undefined) {
        if (
          typeof rawHazard['openDays'] !== 'number' ||
          !Number.isInteger(rawHazard['openDays']) ||
          rawHazard['openDays'] <= 0
        ) {
          problems.push('hazard.openDays must be a positive integer')
        } else {
          openDays = rawHazard['openDays']
        }
      }

      let ceiling = DEFAULT_HAZARD.ceiling
      if (rawHazard['ceiling'] !== undefined) {
        if (
          typeof rawHazard['ceiling'] !== 'number' ||
          !Number.isInteger(rawHazard['ceiling']) ||
          rawHazard['ceiling'] <= 0
        ) {
          problems.push('hazard.ceiling must be a positive integer')
        } else {
          ceiling = rawHazard['ceiling']
        }
      }

      hazard = { openDays, ceiling }
    }
  }

  let symbolIndex: 'codegraph' | 'none' = DEFAULT_SYMBOL_INDEX
  if (rawObj['symbolIndex'] !== undefined) {
    if (rawObj['symbolIndex'] !== 'codegraph' && rawObj['symbolIndex'] !== 'none') {
      problems.push('`symbolIndex` must be "codegraph" or "none"')
    } else {
      symbolIndex = rawObj['symbolIndex']
    }
  }

  let maxBodyBytes = DEFAULT_MAX_BODY_BYTES
  if (rawObj['maxBodyBytes'] !== undefined) {
    if (
      typeof rawObj['maxBodyBytes'] !== 'number' ||
      !Number.isInteger(rawObj['maxBodyBytes']) ||
      rawObj['maxBodyBytes'] <= 0
    ) {
      problems.push('`maxBodyBytes` must be a positive integer')
    } else {
      maxBodyBytes = rawObj['maxBodyBytes']
    }
  }

  let tags: TagsConfig | undefined
  if (rawObj['tags'] !== undefined) {
    tags = parseTags(rawObj['tags'], problems)
  }

  let architecture: Architecture | undefined
  if (rawObj['architecture'] !== undefined) {
    architecture = parseArchitecture(rawObj['architecture'], problems)
  }

  // Check dir collisions between kinds
  const seenDirs = new Map<string, EntityKind>()
  for (const kind of ENTITY_KINDS) {
    const spec = kinds[kind]
    if (spec) {
      const existing = seenDirs.get(spec.dir)
      if (existing) {
        problems.push(
          `kinds \`${existing}\` and \`${kind}\` resolve to the same dir \`${spec.dir}\``,
        )
      } else {
        seenDirs.set(spec.dir, kind)
      }
    }
  }

  if (problems.length > 0) {
    return { ok: false, problems }
  }

  return {
    ok: true,
    config: {
      root,
      kbRoot,
      kinds,
      governedPaths,
      hazard,
      symbolIndex,
      maxBodyBytes,
      ...(tags !== undefined ? { tags } : {}),
      sessionFile: `${kbRoot}/session/current`,
      ...(architecture !== undefined ? { architecture } : {}),
    },
  }
}
