/**
 * Rendering, kept separate from the CLI.
 *
 * Rule 20: controllers only move data. Everything here is a pure
 * (report) -> string, so the output an agent will read is testable without
 * spawning a process or capturing a stream.
 */

import type { Finding, VerifyReport } from './verify.js'
import type { WhyReport } from './why.js'
import type { CtxReport } from './ctx.js'
import type { DoneReport } from './done.js'
import type { AskReport } from './ask.js'
import type { SinceReport } from './since.js'

const ESC = String.fromCharCode(27)

export interface Palette {
  readonly dim: string
  readonly red: string
  readonly yellow: string
  readonly green: string
  readonly bold: string
  readonly off: string
}

export const COLOUR: Palette = {
  dim: `${ESC}[2m`,
  red: `${ESC}[31m`,
  yellow: `${ESC}[33m`,
  green: `${ESC}[32m`,
  bold: `${ESC}[1m`,
  off: `${ESC}[0m`,
}

export const PLAIN: Palette = { dim: '', red: '', yellow: '', green: '', bold: '', off: '' }

function renderFinding(f: Finding, c: Palette): string {
  const tag = f.severity === 'error' ? `${c.red}error${c.off}` : `${c.yellow}warn ${c.off}`
  const hint = f.hint ? `\n         ${c.dim}-> ${f.hint}${c.off}` : ''
  return `  ${tag}  ${c.bold}${f.where}${c.off}\n         ${f.message}${hint}`
}

export function renderVerify(report: VerifyReport, c: Palette = COLOUR): string {
  const errors = report.findings.filter((f) => f.severity === 'error')
  const warnings = report.findings.filter((f) => f.severity === 'warn')
  const summary = `${report.entityCount} entities, ${report.anchorCount} anchors`

  const lines = [...errors, ...warnings].map((f) => renderFinding(f, c))

  lines.push(
    errors.length === 0 && warnings.length === 0
      ? `${c.green}kb verify: clean${c.off} ${c.dim}(${summary})${c.off}`
      : `\nkb verify: ${errors.length} error(s), ${warnings.length} warning(s) ${c.dim}(${summary})${c.off}`,
  )

  // Only mention the index when something actually went unchecked because of it.
  // Printing it on every clean run would train the reader to skip the last line.
  if (!report.indexed && warnings.length > 0) {
    lines.push(
      `${c.dim}${warnings.length} symbol anchor(s) unverified - run \`codegraph init\` to check them.${c.off}`,
    )
  }
  return lines.join('\n')
}

/**
 * `kb verify --since <ref>`.
 *
 * The empty case is the reason this is a separate renderer rather than a filtered call into
 * `renderVerify`. A command that checked nothing and printed nothing is indistinguishable
 * from a broken one — that is INC-0001, and this repository has already paid for it once. So
 * "no entities changed" is said in words, every time, and the ref is named.
 */
export function renderSince(report: SinceReport, c: Palette = COLOUR): string {
  if (report.changed.length === 0) {
    return `${c.dim}kb verify: no files changed since \`${report.ref}\`${c.off}`
  }

  if (report.affected.length === 0) {
    return (
      `${c.dim}kb verify: no entities changed since \`${report.ref}\`${c.off}\n` +
      `${c.dim}(${report.changed.length} file(s) changed, none of them anchored or documented)${c.off}`
    )
  }

  const errors = report.findings.filter((f) => f.severity === 'error')
  const warnings = report.findings.filter((f) => f.severity === 'warn')
  const scope = `${report.affected.length} entity(ies) affected since ${report.ref}`

  return [
    ...[...errors, ...warnings].map((f) => renderFinding(f, c)),
    report.findings.length === 0
      ? `${c.green}kb verify: clean${c.off} ${c.dim}(${scope})${c.off}`
      : `\nkb verify: ${errors.length} error(s), ${warnings.length} warning(s) ${c.dim}(${scope})${c.off}`,
  ].join('\n')
}

export function renderWhy(report: WhyReport, c: Palette = COLOUR): string {
  const { subject } = report

  if (subject) {
    const lines = [
      `${c.bold}${subject.id}${c.off} - ${subject.title} ${c.dim}(${subject.status})${c.off}`,
      `${c.dim}${subject.path}${c.off}`,
      ...report.outgoing.map(
        ({ field, target }) =>
          `  ${field.padEnd(12)} -> ${target.id}  ${c.dim}${target.title}${c.off}`,
      ),
      ...report.incoming.map(
        ({ field, source }) =>
          `  ${c.dim}<-${c.off} ${source.id} ${c.dim}${field}${c.off}  ${source.title}`,
      ),
    ]
    if (report.outgoing.length === 0 && report.incoming.length === 0) {
      lines.push(`  ${c.dim}no links yet${c.off}`)
    }
    return lines.join('\n')
  }

  if (report.mentions.length === 0) {
    return (
      `${c.yellow}Nothing in the knowledge base refers to \`${report.query}\`.${c.off}\n` +
      `${c.dim}That is a finding, not a dead end: code with no recorded purpose is code\n` +
      `nobody can safely change. Record it, or ask why it exists.${c.off}`
    )
  }

  const lines = [
    `${c.bold}${report.query}${c.off}`,
    ...report.mentions.flatMap((m) => [
      `  ${m.entity.id.padEnd(10)} ${m.phrase.padEnd(16)} ${c.dim}${m.matched}${c.off}`,
      `  ${' '.repeat(10)} ${m.entity.title} ${c.dim}(${m.entity.status}, ${m.entity.path})${c.off}`,
    ]),
  ]
  if (report.owner) {
    lines.push(`  ${c.dim}owner: ${report.owner.owner} (via ${report.owner.via})${c.off}`)
  }
  return lines.join('\n')
}

export const USAGE =
  'kb - the intent graph over this repository\n\n' +
  '  kb ask "<query>"       what bears on a task before a work item exists\n' +
  '  kb ctx <W-id>          everything that bears on a piece of work, before you start\n' +
  '  kb why <target>        what a file, symbol, or entity is for\n' +
  '  kb done <W-id>         what still needs recording, before you finish\n' +
  '  kb verify [--strict]   check every claim the docs make about the code\n' +
  '                         --since <ref> only what changed, --fingerprint the finding set\n' +
  '  kb brief [--json]      the cacheable cold-start bundle, in four volatility tiers\n' +
  '                         --check renders twice and compares bytes\n' +
  '  kb guards [--check]    generate checkers from the architecture matrix\n' +
  '  kb owners [--check]    project ownership into CODEOWNERS\n' +
  '  kb pack <subcommand>   portable engineering knowledge packs (list, add, check)\n' +
  '  kb promote <INC-id>    promote a local incident to a pack hazard\n' +
  '  kb upstream [--check]  project attributable incidents into reviewable reports\n' +
  '                         --list, --dry-run, --open-work <path-to-upstream-repo>\n'

export function renderCtx(report: CtxReport, c: Palette = COLOUR): string {
  const { subject } = report
  if (!subject) {
    return (
      `${c.yellow}No work item \`${report.query}\`.${c.off}\n` +
      `${c.dim}Create ${report.workDir ?? '.anchor/work'}/${report.query}.md before starting, so the change and\n` +
      `the reason for it land in the same commit.${c.off}`
    )
  }

  const lines = [
    `${c.bold}${subject.id}${c.off} - ${subject.title} ${c.dim}(${subject.status})${c.off}`,
    `${c.dim}${subject.path}${c.off}`,
  ]

  for (const section of report.sections) {
    lines.push('', `${c.bold}${section.heading}${c.off}`)
    if (section.entries.length === 0) {
      lines.push(`  ${c.dim}${section.emptyNote}${c.off}`)
      continue
    }
    for (const e of section.entries) {
      lines.push(`  ${e.id.padEnd(16)} ${e.title}`)
      lines.push(`  ${' '.repeat(16)} ${c.dim}${e.path} - ${e.via}${c.off}`)
    }
  }

  lines.push('', `${c.bold}Code this work touches${c.off}`)
  lines.push(
    report.anchors.length === 0
      ? `  ${c.dim}nothing anchored yet - add \`touches:\` as you learn what it reaches${c.off}`
      : report.anchors.map((a) => `  ${a}`).join('\n'),
  )
  const trailingHint = report.indexed
    ? 'Read only what applies. Then: codegraph explore "<your question>".'
    : 'Read only what applies.'
  lines.push('', `${c.dim}${trailingHint}${c.off}`)
  return lines.join('\n')
}

/**
 * The Stop hook's one line when source changed under no work item (INC-0001).
 *
 * Yellow, one line, and it names the files. Not red: nothing has failed, and a hook that
 * looks like a failure on a turn that was fine is a hook people learn to scroll past.
 */
export function renderUnclaimed(
  unclaimed: { readonly message: string; readonly fix: string },
  c: Palette = COLOUR,
): string {
  return `${c.yellow}kb done: ${unclaimed.message}${c.off}
    ${c.dim}-> ${unclaimed.fix}${c.off}`
}

/**
 * The no-progress line.
 *
 * Yellow and one line, exactly like `renderUnclaimed`, and for the same reason: nothing has
 * failed. The loop is repeating itself, which is worth saying and not worth stopping for.
 */
export function renderNoProgress(warning: string, c: Palette = COLOUR): string {
  return `${c.yellow}kb done: ${warning}${c.off}
    ${c.dim}-> the last three runs found the same problems; try a different approach${c.off}`
}

export function renderDone(report: DoneReport, c: Palette = COLOUR): string {
  const label = report.work ? `${report.work.id} - ${report.work.title}` : report.workId

  // Open upstream loops are surfaced here because this is where the agent already looks.
  // One yellow line each, never an error and never a failed turn — the rule the Stop hook
  // has followed since INC-0001.
  const notices = report.upstreamNotices.map((n) => `${c.yellow}kb upstream: ${n}${c.off}`)

  if (report.gaps.length === 0) {
    return [
      `${c.green}kb done: ${label} is fully recorded${c.off} ` +
        `${c.dim}(${report.changed.length} file(s) changed)${c.off}`,
      ...notices,
    ].join('\n')
  }

  const lines = [
    `${c.yellow}kb done: ${label} is not closed yet${c.off}`,
    `${c.dim}${report.changed.length} file(s) changed since HEAD${c.off}`,
    '',
  ]
  for (const gap of report.gaps) {
    lines.push(`  ${c.bold}${gap.message}${c.off}`)
    lines.push(`    ${c.dim}-> ${gap.fix}${c.off}`)
  }
  return [...lines, ...notices].join('\n')
}

export function renderAsk(report: AskReport, c: Palette = COLOUR): string {
  const lines: string[] = []

  lines.push(`${c.bold}Invariants (must always hold)${c.off}`)
  if (report.invariants.length === 0) {
    lines.push(`  ${c.dim}no active invariants${c.off}`)
  } else {
    for (const inv of report.invariants) {
      lines.push(`  ${inv.id.padEnd(20)} ${inv.title}`)
      lines.push(`  ${' '.repeat(20)} ${c.dim}${inv.path}${c.off}`)
    }
  }

  if (report.openHazards.length > 0) {
    lines.push('', `${c.bold}Open hazards (unresolved failure modes)${c.off}`)
    for (const haz of report.openHazards) {
      lines.push(`  ${haz.id.padEnd(20)} ${haz.title}`)
      lines.push(`  ${' '.repeat(20)} ${c.dim}${haz.path}${c.off}`)
    }
  }

  const kindHeadings: Record<'ADR' | 'FLOW' | 'WORK' | 'INC', string> = {
    ADR: 'Decisions',
    FLOW: 'User flows',
    WORK: 'Work items',
    INC: 'Incidents',
  }

  if (report.totalMatches === 0) {
    lines.push(
      '',
      `${c.yellow}No ranked matches for "${report.query}" (searched ${report.corpusSize} entities).${c.off}`,
      `${c.dim}The invariants above still apply to all work in this repository.${c.off}`,
    )
  } else {
    for (const kind of ['ADR', 'FLOW', 'WORK', 'INC'] as const) {
      const matches = report.ranked[kind]
      if (matches.length === 0) continue
      lines.push('', `${c.bold}${kindHeadings[kind]}${c.off}`)
      for (const m of matches) {
        lines.push(`  ${m.entity.id.padEnd(20)} ${m.entity.title} ${c.dim}(${m.entity.status})${c.off}`)
        lines.push(`  ${' '.repeat(20)} ${c.dim}${m.entity.path}${c.off}`)
      }
    }
  }

  if (report.doctrine.length > 0) {
    lines.push('', `${c.bold}Doctrine${c.off}`)
    for (const doc of report.doctrine) {
      const label = doc.title ? `${doc.name} - ${doc.title}` : doc.name
      lines.push(`  ${label}`)
      lines.push(`  ${' '.repeat(2)} ${c.dim}${doc.path}${c.off}`)
    }
  }

  return lines.join('\n')
}

