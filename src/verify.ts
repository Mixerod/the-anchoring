/**
 * `kb verify` — the machine gate.
 *
 * The rule this enforces: an invariant that matters is checked by a program, not
 * described in a paragraph. Every claim the intent graph makes about code is
 * re-tested here on every run, so documentation that drifts fails the build instead
 * of quietly becoming fiction.
 */

import { LINK_FIELDS, kindOf } from './model.js'
import { type Entity, type Store } from './store.js'
import { loadStore } from './loader.js'
import { type Resolver } from './anchors.js'
import { createResolver } from './resolver.js'
import type { AnchoringConfig } from './config.js'
import { checkHazard, checkHazardCeiling } from './verify-hazard.js'
import { checkUpstream, checkUpstreamCeiling } from './verify-upstream.js'
import type { Finding, Severity } from './finding.js'

export type { Finding, Severity }
export { checkUpstream, checkHazard }

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

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function checkTags(entity: Entity): readonly Finding[] {
  const raw = entity.fields['tags']
  if (raw === undefined) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = undefined
  }

  if (!Array.isArray(parsed)) {
    return [
      {
        severity: 'error',
        where: `${entity.id} · tags`,
        message: `\`${raw}\` must be a list of lowercase slugs`,
        hint: 'tags must be formatted as a YAML list of lowercase slugs, e.g. [foo, bar]',
      },
    ]
  }

  const findings: Finding[] = []
  for (const item of parsed) {
    const str = typeof item === 'string' ? item : String(item)
    if (typeof item !== 'string' || !SLUG_PATTERN.test(item)) {
      findings.push({
        severity: 'error',
        where: `${entity.id} · tags`,
        message: `\`${str}\` is not a lowercase slug`,
        hint: 'a tag must contain only lowercase letters, numbers, and hyphens',
      })
    }
  }
  return findings
}

/**
 * The body budget.
 *
 * **A warning under every flag, including `--strict`. Never an error, ever.** A build that
 * goes red because a document is verbose is a build people learn to bypass, and the checks
 * that matter get bypassed along with it — rule 8. If you are here to promote this to an
 * error, the thing you would be breaking is every other check in this file.
 *
 * An unmeasured body (`bodyBytes` absent) is not reported: "we did not look" and "it is
 * within budget" are different facts, and silently merging them is how a gate starts lying.
 */
export function checkBodyBudget(entity: Entity, maxBodyBytes: number): readonly Finding[] {
  const bytes = entity.bodyBytes
  if (bytes === undefined || bytes <= maxBodyBytes) return []

  return [
    {
      severity: 'warn',
      advisory: true,
      where: `${entity.id} · body`,
      message: `body is ${bytes} bytes, ${bytes - maxBodyBytes} over the ${maxBodyBytes}-byte budget`,
      hint: 'every agent reads this on every cold start; split it or cut it, or raise maxBodyBytes deliberately',
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
    findings.push(...checkTags(entity))
    findings.push(...checkBodyBudget(entity, config.maxBodyBytes))
    findings.push(...checkUpstream(entity, config, now))
    const anchors = checkAnchors(entity, resolver)
    findings.push(...anchors.findings)
    anchorCount += anchors.count
  }

  findings.push(...checkHazardCeiling(store, config.hazard.ceiling))
  findings.push(...checkUpstreamCeiling(store))

  return { findings, entityCount: store.byId.size, anchorCount, indexed: resolver.indexed }
}
