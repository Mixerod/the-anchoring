/**
 * `kb verify` — the machine gate.
 *
 * The rule this enforces: an invariant that matters is checked by a program, not
 * described in a paragraph. Every claim the intent graph makes about code is
 * re-tested here on every run, so documentation that drifts fails the build instead
 * of quietly becoming fiction.
 */

import {
  HAZARD_RESOLUTIONS,
  LINK_FIELDS,
  kindOf,
} from './model.js'
import { loadStore, type Entity, type Store } from './store.js'
import { createResolver, type Resolver } from './anchors.js'
import type { AnchoringConfig } from './config.js'

export type Severity = 'error' | 'warn'

export interface Finding {
  readonly severity: Severity
  readonly where: string
  readonly message: string
  readonly hint?: string
}

export interface VerifyReport {
  readonly findings: readonly Finding[]
  readonly entityCount: number
  readonly anchorCount: number
  readonly indexed: boolean
}

function checkRefs(entity: Entity, store: Store, config: AnchoringConfig): readonly Finding[] {
  const findings: Finding[] = []
  const spec = LINK_FIELDS[entity.kind]

  for (const [field, values] of Object.entries(entity.links)) {
    const fieldSpec = spec[field]
    if (!fieldSpec || fieldSpec.kind !== 'ref') continue

    for (const value of values) {
      const target = store.byId.get(value)
      if (!target) {
        const known = kindOf(config, value)
        findings.push({
          severity: 'error',
          where: `${entity.id} · ${field}`,
          message: `points at \`${value}\`, which does not exist`,
          hint: known
            ? `create the ${known} document, or remove the reference`
            : `\`${value}\` does not match any known id pattern`,
        })
        continue
      }
      if (!fieldSpec.to.includes(target.kind)) {
        findings.push({
          severity: 'error',
          where: `${entity.id} · ${field}`,
          message: `points at a ${target.kind}, but this field only accepts ${fieldSpec.to.join('/')}`,
        })
      }
    }
  }
  return findings
}

function checkAnchors(entity: Entity, resolver: Resolver): { findings: readonly Finding[]; count: number } {
  const findings: Finding[] = []
  const spec = LINK_FIELDS[entity.kind]
  let count = 0

  for (const [field, values] of Object.entries(entity.links)) {
    if (spec[field]?.kind !== 'anchor') continue

    for (const raw of values) {
      count += 1
      const result = resolver.resolve(raw)
      if (result.status === 'resolved') continue

      findings.push({
        severity: result.status === 'unverifiable' ? 'warn' : 'error',
        where: `${entity.id} · ${field}`,
        message: `anchor \`${raw}\` — ${result.detail ?? result.status}`,
        ...(result.status === 'missing'
          ? { hint: 'the code moved or was renamed; update the anchor in the same commit' }
          : {}),
      })
    }
  }
  return { findings, count }
}

const URL_SHAPED = /^https?:\/\/\S+$/
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

/**
 * The three constraints that make a hazard worth having, checked rather than described.
 *
 * Without a source it is a rumour; without a resolution it is a worry nobody owns; and
 * `open` past hazard.openDays warns, which `--strict` turns into a failed build. That
 * escalation is the whole point of the kind — see ADR-0015.
 */
function checkHazard(
  entity: Entity,
  now: Date,
  hazardConfig: { readonly openDays: number; readonly ceiling: number },
): readonly Finding[] {
  if (entity.kind !== 'HAZ' || entity.status !== 'active') return []

  const findings: Finding[] = []
  const at = (field: string) => `${entity.id} · ${field}`
  const { source, observed, recorded, resolution, reason } = entity.fields

  if (!source) {
    findings.push({
      severity: 'error',
      where: at('source'),
      message: 'has no `source`',
      hint: 'a hazard with no public URL is a rumour; cite the report and the date, or delete it',
    })
  } else if (!URL_SHAPED.test(source)) {
    findings.push({
      severity: 'error',
      where: at('source'),
      message: `\`${source}\` must be an http(s) URL`,
    })
  }

  for (const [field, value] of [
    ['observed', observed],
    ['recorded', recorded],
  ] as const) {
    if (value === undefined || !ISO_DAY.test(value)) {
      findings.push({
        severity: 'error',
        where: at(field),
        message: `\`${field}\` must be a YYYY-MM-DD date${value === undefined ? ', and is missing' : `, not \`${value}\``}`,
      })
    }
  }

  const guarded = (entity.links['resolves_to'] ?? []).length > 0

  if (resolution === undefined) {
    findings.push({
      severity: 'error',
      where: at('resolution'),
      message: 'has no `resolution`',
      hint: `one of: ${HAZARD_RESOLUTIONS.join(', ')}`,
    })
  } else if (!(HAZARD_RESOLUTIONS as readonly string[]).includes(resolution)) {
    findings.push({
      severity: 'error',
      where: at('resolution'),
      message: `\`${resolution}\` is not one of: ${HAZARD_RESOLUTIONS.join(', ')}`,
    })
  } else if (resolution === 'guarded' && !guarded) {
    findings.push({
      severity: 'error',
      where: at('resolution'),
      message: 'is `guarded` but names no invariant',
      hint: 'add `resolves_to: [INV-...]`, or the guard is a claim nobody can find',
    })
  } else if (resolution !== 'guarded' && guarded) {
    findings.push({
      severity: 'error',
      where: at('resolves_to'),
      message: `is set, but only \`guarded\` may name an invariant (this is \`${resolution}\`)`,
    })
  } else if ((resolution === 'accepted' || resolution === 'not-applicable') && !reason) {
    findings.push({
      severity: 'error',
      where: at('resolution'),
      message: `is \`${resolution}\` but gives no \`reason\``,
      hint: 'a decision to live with something has to say why, or the next reader re-opens it',
    })
  } else if (resolution === 'open' && recorded !== undefined && ISO_DAY.test(recorded)) {
    const days = Math.floor((now.getTime() - Date.parse(`${recorded}T00:00:00Z`)) / DAY_MS)
    if (days > hazardConfig.openDays) {
      findings.push({
        severity: 'warn',
        where: at('resolution'),
        message: `has been open for ${days} days (limit ${hazardConfig.openDays})`,
        hint: 'guard it with an INV- and a checker, or record it as accepted/not-applicable with a reason',
      })
    }
  }

  const anchors = entity.links['holds_for'] ?? []
  if (anchors.length === 0) {
    findings.push({
      severity: 'error',
      where: at('holds_for'),
      message: 'names no code, so nothing can ever surface it',
      hint: 'hazards reach an agent by anchor intersection; without one this document is inert',
    })
  }
  for (const anchor of anchors.filter((a) => !a.startsWith('file:'))) {
    findings.push({
      severity: 'error',
      where: at('holds_for'),
      message: `\`${anchor}\` must be a \`file:\` anchor`,
      hint: 'sym: anchors are unverifiable until codegraph is indexed, so they cannot drive the intersection',
    })
  }

  return findings
}

/**
 * An accepted decision that anchors nothing cannot be found by the query built to find it.
 *
 * INC-0001: `ADR-0006` carried `governs: []` with a note reading "no code yet - Phase 1".
 * By the time `apps/web` had code the anchor was still empty, so `kb why apps/web` could not
 * reach the decision that chose SVG and bought the accessibility budget. Nothing ever asks
 * again once the note is written — an empty anchor with a promise attached is an anchor that
 * stays empty.
 *
 * A warning rather than an error, because some decisions genuinely govern no code: ADR-0010
 * names the project, ADR-0011 removes scope. `--strict` escalates it, which puts the question
 * in CI where it should be answered rather than in the way of a local commit.
 *
 * `governs_nothing: <reason>` silences it. That field is the point of the check as much as
 * the warning is: it costs one line, but writing the line forces the author to decide which
 * case they are in, so the silence becomes a declaration instead of an oversight.
 */
function checkGovernsSomething(entity: Entity): readonly Finding[] {
  if (entity.kind !== 'ADR' || entity.status !== 'accepted') return []
  if ((entity.links['governs'] ?? []).length > 0) return []
  if ((entity.fields['governs_nothing'] ?? '').trim().length > 0) return []

  return [
    {
      severity: 'warn',
      where: `${entity.id} · governs`,
      message: 'is accepted but governs nothing, so `kb why <file>` can never reach it',
      hint: 'anchor the code it binds; an empty anchor with a promise to fill it later stays empty',
    },
  ]
}

/** A superseded decision must name its successor, or the history has a hole in it. */
function checkSupersession(entity: Entity, store: Store): readonly Finding[] {
  if (entity.kind !== 'ADR' || entity.status !== 'superseded') return []
  const successor = [...store.byId.values()].some(
    (other) => other.kind === 'ADR' && (other.links['supersedes'] ?? []).includes(entity.id),
  )
  return successor
    ? []
    : [
        {
          severity: 'error',
          where: entity.id,
          message: 'is marked superseded but no other ADR claims to supersede it',
          hint: 'add `supersedes: [' + entity.id + ']` to the ADR that replaced it',
        },
      ]
}

const OWNER_SHAPED = /^(@[a-zA-Z0-9_.-]+|team:[a-zA-Z0-9_.-]+)$/

function checkOwner(entity: Entity): readonly Finding[] {
  const owner = entity.fields['owner']
  if (owner === undefined) return []

  const trimmed = owner.trim()
  if (!OWNER_SHAPED.test(trimmed)) {
    return [
      {
        severity: 'error',
        where: `${entity.id} · owner`,
        message: `\`${owner}\` must be shaped \`@handle\` or \`team:<name>\``,
        hint: 'an ownership field that accepts anything identifies nobody',
      },
    ]
  }
  return []
}

function checkHazardCeiling(store: Store, ceiling: number): readonly Finding[] {
  const active = [...store.byId.values()].filter((e) => e.kind === 'HAZ' && e.status === 'active')
  return active.length <= ceiling
    ? []
    : [
        {
          severity: 'error',
          where: 'hazards',
          message: `${active.length} active hazards, ceiling is ${ceiling}`,
          hint: 'promote one to an INV- with a real checker, or retire it — the ceiling is what keeps this list read',
        },
      ]
}

export function verify(config: AnchoringConfig, now: Date = new Date()): VerifyReport {
  const store = loadStore(config)
  const resolver = createResolver(config)

  const findings: Finding[] = store.problems.map((p) => ({
    severity: 'error' as const,
    where: p.path,
    message: p.message,
  }))

  let anchorCount = 0
  for (const entity of store.byId.values()) {
    findings.push(...checkRefs(entity, store, config))
    findings.push(...checkSupersession(entity, store))
    findings.push(...checkGovernsSomething(entity))
    findings.push(...checkHazard(entity, now, config.hazard))
    findings.push(...checkOwner(entity))
    const anchors = checkAnchors(entity, resolver)
    findings.push(...anchors.findings)
    anchorCount += anchors.count
  }

  findings.push(...checkHazardCeiling(store, config.hazard.ceiling))

  return { findings, entityCount: store.byId.size, anchorCount, indexed: resolver.indexed }
}
