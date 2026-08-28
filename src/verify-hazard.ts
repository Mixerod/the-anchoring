/**
 * The hazard checks, split out of `verify.ts`.
 *
 * A `HAZ-` is the one kind that describes something which has not happened here yet, so it
 * is the kind most likely to decay into an unread wishlist. These three constraints — a
 * source, a resolution, and a clock on `open` — are what keep it a checker instead of a
 * reading list. See ADR-0015 and docs/THE_ANCHORING.md, slice 4.
 */

import { HAZARD_RESOLUTIONS } from './model.js'
import type { Entity, Store } from './store.js'
import { ISO_DAY, daysSince, type Finding } from './finding.js'

const URL_SHAPED = /^https?:\/\/\S+$/

/**
 * The three constraints that make a hazard worth having, checked rather than described.
 *
 * Without a source it is a rumour; without a resolution it is a worry nobody owns; and
 * `open` past hazard.openDays warns, which `--strict` turns into a failed build. That
 * escalation is the whole point of the kind — see ADR-0015.
 */
export function checkHazard(
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
    const days = daysSince(recorded, now)
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
  if (resolution !== 'not-applicable' && anchors.length === 0) {
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

export function checkHazardCeiling(store: Store, ceiling: number): readonly Finding[] {
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

