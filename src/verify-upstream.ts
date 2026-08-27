/**
 * The upstream-attribution checks, split out of `verify.ts`.
 *
 * The default verdict is `local`: an incident is the project's fault until
 * machine-checkable evidence says otherwise. Everything here exists to make the other two
 * verdicts cost something, because over-attribution — not under-attribution — is this
 * feature's failure mode. See docs/THE_ANCHORING.md, "The upstream loop".
 */

import {
  EVIDENCE_CLASSES,
  SHIPPED_INVARIANTS,
  UPSTREAM_CEILING,
  UPSTREAM_GATES,
  UPSTREAM_OPEN_DAYS,
  UPSTREAM_VERDICTS,
} from './model.js'
import type { Entity, Store } from './store.js'
import type { AnchoringConfig } from './config.js'
import { ISO_DAY, daysSince, type Finding } from './finding.js'

/**
 * Whether an incident is escalated to a package other than this repository.
 *
 * Everything here reads frontmatter and nothing reads a document body — `store.ts` never
 * loads one, and this must not become the reason it starts.
 */
export function isEscalated(entity: Entity): boolean {
  return entity.kind === 'INC' && entity.fields['upstream_verdict'] === 'upstream'
}

/** A `touches:` anchor pointing at something the tool itself wrote. */
function touchesGeneratedArtifact(entity: Entity, config: AnchoringConfig): boolean {
  const kbRoot = config.kbRoot.replace(/\/+$/, '')
  return (entity.links['touches'] ?? []).some((raw) => {
    if (!raw.startsWith('file:')) return false
    const path = raw.slice('file:'.length).split('\\').join('/').replace(/^\.\//, '')
    const base = path.split('/').pop() ?? ''
    return path === kbRoot || path.startsWith(`${kbRoot}/`) || base.startsWith('anchoring.')
  })
}

/**
 * The attribution gate: is this incident the project's fault, or the package's?
 *
 * Built like `checkHazard`, and for the same reason. The default verdict is `local` and an
 * absent `upstream_verdict` is exactly that — silence costs nothing and requires nothing.
 * Every other verdict has to pay: a package name, one of four closed evidence classes, the
 * field that class demands, and a date. The point is not to make escalation hard; it is to
 * make it *checkable*, so a run of escalations is evidence rather than opinion.
 */
export function checkUpstream(
  entity: Entity,
  config: AnchoringConfig,
  now: Date,
): readonly Finding[] {
  if (entity.kind !== 'INC') return []

  const at = (field: string) => `${entity.id} · ${field}`
  const verdict = entity.fields['upstream_verdict']

  // Absent is `local`, and `local` requires nothing at all.
  if (verdict === undefined || verdict === 'local') return []

  if (!(UPSTREAM_VERDICTS as readonly string[]).includes(verdict)) {
    return [
      {
        severity: 'error',
        where: at('upstream_verdict'),
        message: `\`${verdict}\` is not one of: ${UPSTREAM_VERDICTS.join(', ')}`,
        hint: 'the default is `local`; an incident is the project\'s fault until evidence says otherwise',
      },
    ]
  }

  const findings: Finding[] = []
  const pkg = entity.fields['upstream']

  if (!pkg || pkg.trim() === '') {
    findings.push({
      severity: 'error',
      where: at('upstream'),
      message: `verdict is \`${verdict}\` but no package is named`,
      hint: 'add `upstream: <package-name>` — attribution to nobody in particular is not attribution',
    })
  }

  // `unclear` is an honest halt: it names a suspicion and stops there. It carries no
  // evidence class on purpose, and no report is ever generated from it.
  if (verdict === 'unclear') return findings

  const evidence = entity.fields['upstream_evidence']
  if (evidence === undefined) {
    findings.push({
      severity: 'error',
      where: at('upstream_evidence'),
      message: 'verdict is `upstream` but names no evidence class',
      hint: `one of: ${EVIDENCE_CLASSES.join(', ')}`,
    })
  } else if (!(EVIDENCE_CLASSES as readonly string[]).includes(evidence)) {
    findings.push({
      severity: 'error',
      where: at('upstream_evidence'),
      message: `\`${evidence}\` is not one of: ${EVIDENCE_CLASSES.join(', ')}`,
      hint: 'the list is closed; a fifth class needs an ADR arguing why four were insufficient',
    })
  } else if (evidence === 'silent-gate') {
    const gate = entity.fields['upstream_gate']
    if (gate === undefined || !(UPSTREAM_GATES as readonly string[]).includes(gate)) {
      findings.push({
        severity: 'error',
        where: at('upstream_gate'),
        message: `silent-gate must name the gate that stayed silent${gate === undefined ? ', and gives none' : `, not \`${gate}\``}`,
        hint: `one of: ${UPSTREAM_GATES.join(', ')}`,
      })
    }
  } else if (evidence === 'generated-artifact' && !touchesGeneratedArtifact(entity, config)) {
    findings.push({
      severity: 'error',
      where: at('touches'),
      message: 'generated-artifact names no anchor in a file the tool generated',
      hint: `anchor a file under \`${config.kbRoot}/\` or an \`anchoring.*\` file, or the class does not apply`,
    })
  } else if (evidence === 'shipped-invariant') {
    const violates = entity.links['violates'] ?? []
    if (!violates.some((id) => (SHIPPED_INVARIANTS as readonly string[]).includes(id))) {
      findings.push({
        severity: 'error',
        where: at('violates'),
        message: 'shipped-invariant names none of the shipped invariants',
        hint: `one of: ${SHIPPED_INVARIANTS.join(', ')}`,
      })
    }
  } else if (evidence === 'schema-gap' && !(entity.fields['upstream_rejected'] ?? '').trim()) {
    findings.push({
      severity: 'error',
      where: at('upstream_rejected'),
      message: 'schema-gap carries no rejected frontmatter snippet',
      hint: 'paste what the validator refused; without it nobody upstream can reproduce the gap',
    })
  }

  const recorded = entity.fields['upstream_recorded']
  if (recorded === undefined || !ISO_DAY.test(recorded)) {
    findings.push({
      severity: 'error',
      where: at('upstream_recorded'),
      message: `must be a YYYY-MM-DD date${recorded === undefined ? ', and is missing' : `, not \`${recorded}\``}`,
    })
  } else if (!entity.fields['upstream_work']) {
    const days = daysSince(recorded, now)
    if (days > UPSTREAM_OPEN_DAYS) {
      findings.push({
        severity: 'warn',
        where: at('upstream_recorded'),
        message: `escalated ${days} days ago with no work item opened (limit ${UPSTREAM_OPEN_DAYS})`,
        hint: 'run `kb upstream --open-work <path>`, or drop the verdict back to `local` — an unread UP- is worse than none',
      })
    }
  }

  return findings
}

export function checkUpstreamCeiling(store: Store): readonly Finding[] {
  const open = [...store.byId.values()].filter(
    (e) => isEscalated(e) && !e.fields['upstream_work'],
  )
  return open.length <= UPSTREAM_CEILING
    ? []
    : [
        {
          severity: 'error',
          where: 'upstream',
          message: `${open.length} incidents escalated upstream with no work item, ceiling is ${UPSTREAM_CEILING}`,
          hint: 'open the work items, or reclassify — an unbounded backlog of other people\'s bugs is a graveyard',
        },
      ]
}

