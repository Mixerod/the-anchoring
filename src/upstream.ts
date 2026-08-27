/**
 * `kb upstream` — projecting attributable incidents into reviewable reports.
 *
 * **Purity is the redaction mechanism, and that is the whole design.** `planUpstream`
 * performs no I/O: no filesystem, no child process, no clock, no `node:crypto`. A function
 * that cannot read a file cannot leak one — not a source line, not a diff, not a secret,
 * not an environment variable. That is a guarantee the type system carries and no review
 * has to re-establish, which is strictly stronger than a redaction filter that has to be
 * right every time. It must stay pure even when adding a "helpful" excerpt of the offending
 * code would be one line of `readFileSync`; that one line would convert a structural
 * guarantee into a promise.
 *
 * Everything a report may contain comes from frontmatter the author wrote by hand, from
 * `anchoring.config.json`, or from the package facts `cli.ts` reads and passes in. Anchors
 * appear as the paths they already are. The downstream repository is identified by its
 * directory name and never by its location on disk.
 *
 * No command in this module reaches the network, ever. The tool writes a document; a person
 * reads it and decides whether to carry it. See docs/THE_ANCHORING.md, "The upstream loop".
 */

import type { AnchoringConfig } from './config.js'
import type { Entity, Store } from './store.js'
import { EVIDENCE_CLASSES } from './model.js'

export interface PackageFacts {
  readonly name: string
  readonly version: string
}

export interface UpstreamReport {
  readonly id: string // UP-0001
  readonly about: string // INC-0007
  readonly path: string // <kbRoot>/upstream/UP-0001.md
  readonly body: string
}

export interface UpstreamPlan {
  readonly reports: readonly UpstreamReport[]
  readonly notes: readonly string[]
}

export type UpstreamFileState = 'ok' | 'missing' | 'stale' | 'hand-edited'

export interface FileState {
  readonly path: string
  readonly state: UpstreamFileState
}

/** A row of `--list`, including the ones that were *not* escalated. */
export interface UpstreamListRow {
  readonly id: string
  readonly verdict: string
  readonly pkg: string
  readonly evidence: string
  readonly reason: string
}

export const UPSTREAM_BANNER =
  'Review this file before sending it anywhere. It leaves your machine only if you carry it.'

const NOTES_HEADING = '## Notes'

function escalated(store: Store): readonly Entity[] {
  return [...store.byId.values()]
    .filter((e) => e.kind === 'INC' && e.fields['upstream_verdict'] === 'upstream')
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** Anchors as paths. `file:` and `sym:` prefixes are dropped; nothing is resolved. */
function touchedPaths(entity: Entity): readonly string[] {
  return (entity.links['touches'] ?? []).map((raw) =>
    raw.startsWith('file:') ? raw.slice('file:'.length) : raw,
  )
}

/**
 * The generated-header hash, computed the same way `guardsHash` is and for the same
 * reason: so a drifted file is distinguishable from an edited one without a crypto import.
 * FNV-1a over the canonical body — see `hashableBody` for what "canonical" means here.
 */
export function upstreamHash(body: string): string {
  const str = hashableBody(body)
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i))
    hash = (hash * prime) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}

/**
 * The non-obvious part of this module.
 *
 * `status:` is the one field a human is *supposed* to edit — `draft` → `sent` → `accepted`
 * | `declined` — and appending to `## Notes` is how they record what happened when they
 * carried it. Neither is drift. So the hash is computed with `status:` normalised back to
 * `draft` and everything from the `## Notes` heading onward removed. Change anything else
 * and the hash moves, which is exactly what `hand-edited` should mean: somebody rewrote
 * the evidence rather than annotating it.
 */
function hashableBody(body: string): string {
  const withoutNotes = body.split(`\n${NOTES_HEADING}`)[0] ?? body
  return withoutNotes.replace(/^status: .*$/m, 'status: draft')
}

function renderPrompt(entity: Entity, pkg: PackageFacts, evidence: string): string {
  const gate = entity.fields['upstream_gate']
  const lines = [
    `An adopter of ${pkg.name}@${pkg.version} hit this. Reproduce it before fixing it.`,
    '',
    `What happened: ${entity.title}`,
    `Evidence class: ${evidence}`,
  ]
  if (gate) {
    lines.push(`The gate that stayed silent: kb ${gate}`)
  }
  lines.push(
    '',
    'Investigate first:',
    evidence === 'silent-gate'
      ? `- write the case where \`kb ${gate ?? '<gate>'}\` must speak, and confirm it currently does not`
      : evidence === 'generated-artifact'
        ? '- regenerate the named artifact from the architecture block and diff it against what shipped'
        : evidence === 'shipped-invariant'
          ? '- read the shipped invariant named below and decide whether it was wrong or merely insufficient'
          : '- read the rejected frontmatter below and decide whether the schema or the modelling was wrong',
    '- only then change code. A fix with no failing case first is a guess.',
  )
  return lines.join('\n')
}

function renderReport(
  entity: Entity,
  config: AnchoringConfig,
  pkg: PackageFacts,
  id: string,
): string {
  const evidence = entity.fields['upstream_evidence'] ?? ''
  const upstreamFields = Object.entries(entity.fields)
    .filter(([k]) => k.startsWith('upstream'))
    .sort(([a], [b]) => a.localeCompare(b))

  const architecture = config.architecture
    ? JSON.stringify(config.architecture, null, 2)
    : '(no architecture block declared)'

  const paths = touchedPaths(entity)
  const rejected = entity.fields['upstream_rejected']

  const sections: string[] = [
    `---
id: ${id}
about: ${entity.id}
package: ${pkg.name}
package_version: ${pkg.version}
evidence: ${evidence}
status: draft
---`,
    `<!-- GENERATED BY \`kb upstream\` — DO NOT EDIT, except \`status:\` and the Notes section. -->
<!-- kb-upstream-hash: __HASH__ -->`,
    `> ${UPSTREAM_BANNER}`,
    `# ${id} — ${entity.title}`,
    `## The incident

- id: \`${entity.id}\`
- title: ${entity.title}
- status: \`${entity.status}\``,
    `## Attribution

${upstreamFields.map(([k, v]) => `- \`${k}\`: ${v}`).join('\n') || '- (none)'}`,
    `## Code it touches

${paths.length > 0 ? paths.map((p) => `- \`${p}\``).join('\n') : '- (no anchors)'}`,
    `## The adopter's architecture

\`\`\`json
${architecture}
\`\`\``,
  ]

  if (evidence === 'schema-gap' && rejected) {
    sections.push(`## The frontmatter the validator refused

\`\`\`yaml
${rejected}
\`\`\``)
  }

  sections.push(`## For an upstream agent

\`\`\`
${renderPrompt(entity, pkg, evidence)}
\`\`\``)

  sections.push(`${NOTES_HEADING}

<!-- Yours. Append freely; it is excluded from the drift hash. -->`)

  const body = `${sections.join('\n\n')}\n`
  return body.replace('__HASH__', upstreamHash(body))
}

/**
 * Which incidents were *not* escalated, and why. `--list` shows these rows too.
 *
 * A tool that only ever displays what it escalated cannot be audited for over-attribution,
 * and over-attribution is this feature's main failure mode. The negative path is the part
 * worth reading.
 */
export function listUpstream(store: Store): readonly UpstreamListRow[] {
  return [...store.byId.values()]
    .filter((e) => e.kind === 'INC')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => {
      const verdict = e.fields['upstream_verdict'] ?? 'local'
      const evidence = e.fields['upstream_evidence'] ?? '-'
      const work = e.fields['upstream_work']
      const reason =
        verdict === 'local'
          ? 'not escalated: the project’s own fault'
          : verdict === 'unclear'
            ? 'not escalated: no evidence class applies'
            : work
              ? `escalated, work item ${work}`
              : 'escalated, no work item opened'
      return { id: e.id, verdict, pkg: e.fields['upstream'] ?? '-', evidence, reason }
    })
}

/** A report already on disk: which `UP-` id it is, and which incident it is about. */
export interface ExistingReport {
  readonly id: string
  readonly about: string
}

/**
 * Reports for every incident at verdict `upstream` that lacks one.
 *
 * Ids are stable by construction: an incident that already has a report keeps its id,
 * because the pairing is read back from the `about:` line of what is already on disk.
 * Allocation only ever happens for an incident with no report yet, and never reuses an id
 * some other report already holds. Without that, a second `kb upstream --check` would
 * allocate `UP-0002` for the incident `UP-0001` already covers and report it `missing`.
 *
 * Pure: `existing` is read by `cli-upstream.ts` and passed in, never listed from disk here.
 */
export function planUpstream(
  config: AnchoringConfig,
  store: Store,
  pkg: PackageFacts,
  existing: readonly ExistingReport[] = [],
): UpstreamPlan {
  const byIncident = new Map(existing.map((e) => [e.about, e.id]))
  const taken = new Set(existing.map((e) => e.id))
  const notes: string[] = []
  const reports: UpstreamReport[] = []

  let next = 1
  const allocate = (): string => {
    let id = `UP-${String(next).padStart(4, '0')}`
    while (taken.has(id)) {
      next += 1
      id = `UP-${String(next).padStart(4, '0')}`
    }
    taken.add(id)
    next += 1
    return id
  }

  for (const entity of escalated(store)) {
    const evidence = entity.fields['upstream_evidence'] ?? ''
    if (!(EVIDENCE_CLASSES as readonly string[]).includes(evidence)) {
      // `kb verify` is the gate that reports this; here it only means "no report yet".
      notes.push(
        `${entity.id}: no report — evidence class \`${evidence || '(none)'}\` is not one of the four`,
      )
      continue
    }
    const id = byIncident.get(entity.id) ?? allocate()
    reports.push({
      id,
      about: entity.id,
      path: `${config.kbRoot}/upstream/${id}.md`,
      body: renderReport(entity, config, pkg, id),
    })
  }

  if (reports.length === 0) {
    notes.push('no incident sits at verdict `upstream`; nothing to report')
  }

  return { reports, notes }
}

const HASH_LINE = /kb-upstream-hash: ([0-9a-f]{16})/

/**
 * The four states a report on disk can be in.
 *
 * `hand-edited` and `stale` are told apart the way `checkGuards` tells them apart: a file
 * whose own hash no longer describes its own body was rewritten by a person, while a file
 * that is internally consistent but carries a different hash from the one we would now
 * generate has simply fallen behind its source. Different mistakes, different fixes.
 */
export function checkUpstream(
  plan: UpstreamPlan,
  read: (p: string) => string | undefined,
): readonly FileState[] {
  return plan.reports.map((report) => {
    const actual = read(report.path)
    if (actual === undefined) return { path: report.path, state: 'missing' as const }
    if (actual === report.body) return { path: report.path, state: 'ok' as const }

    const actualHash = actual.match(HASH_LINE)?.[1]
    if (actualHash === undefined) return { path: report.path, state: 'hand-edited' as const }

    // Self-consistency, computed over the canonical body: `status:` and everything under
    // `## Notes` are the author's to change and must not read as drift.
    if (upstreamHash(actual.replace(actualHash, '__HASH__')) !== actualHash) {
      return { path: report.path, state: 'hand-edited' as const }
    }

    const plannedHash = report.body.match(HASH_LINE)?.[1]
    return {
      path: report.path,
      state: actualHash === plannedHash ? ('ok' as const) : ('stale' as const),
    }
  })
}

/**
 * One line per open loop, for `kb done` to append where the agent already looks.
 *
 * Surfacing costs nothing and reaches the one place an agent reliably reads. It is a note,
 * never an error and never a failed turn — the rule the Stop hook has followed since
 * INC-0001, because a gate that blocks on bookkeeping is switched off within a week.
 */
export function openLoopNotices(store: Store): readonly string[] {
  const notices: string[] = []
  for (const entity of [...store.byId.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (entity.kind !== 'INC') continue
    const verdict = entity.fields['upstream_verdict']
    if (verdict === 'unclear') {
      notices.push(`${entity.id} sits at verdict \`unclear\` — decide, or it stays undecided`)
    } else if (verdict === 'upstream' && !entity.fields['upstream_work']) {
      notices.push(`${entity.id} is escalated upstream with no work item opened`)
    }
  }
  return notices
}
