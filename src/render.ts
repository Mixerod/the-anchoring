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
  '  kb ctx <W-id>          everything that bears on a piece of work, before you start\n' +
  '  kb why <target>        what a file, symbol, or entity is for\n' +
  '  kb done <W-id>         what still needs recording, before you finish\n' +
  '  kb verify [--strict]   check every claim the docs make about the code\n' +
  '  kb guards [--check]    generate checkers from the architecture matrix\n' +
  '  kb owners [--check]    project ownership into CODEOWNERS\n' +
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
