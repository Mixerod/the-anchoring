/**
 * How `kb skills` prints a skill budget.
 *
 * Two honesty requirements, stated where the code is.
 *
 * **The estimate says it is one.** No tokenizer is called, so every token figure is
 * arithmetic on a byte count and prints with the word "estimate" and its divisor, exactly as
 * `render-stats.ts` does for the corpus. A confident count derived from nothing reads the
 * same as a real one, and that is the over-claiming the discipline rules exist to prevent.
 *
 * **The negative path is visible.** A filter whose rejections nobody can see is a filter
 * nobody can audit, so this printer names what it did *not* count: cloud lines it cannot
 * weigh offline, gitignore patterns it does not implement, and the Tier 2 skills that cost
 * nothing and therefore need no justification. A budget that quietly omitted them would
 * under-report in the one direction that matters.
 *
 * Pure module.
 */

import { AUTOTRIGGER_FILE, ATSKILLS_DIR, BYTES_PER_TOKEN_ESTIMATE, type SkillsReport } from './skills.js'
import type { Palette } from './render.js'

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function residentSection(report: SkillsReport, c: Palette): readonly string[] {
  const header =
    `${c.bold}Tier 3 - ${AUTOTRIGGER_FILE}${c.off} ` +
    `${c.dim}(${plural(report.resident.length, 'skill', 'skills')}, ` +
    `~${report.residentTokens} tok/message, estimated at ${BYTES_PER_TOKEN_ESTIMATE} bytes/token)${c.off}`

  if (report.resident.length === 0) {
    return [header, `  ${c.dim}nothing fires on its own${c.off}`]
  }

  const width = Math.max(...report.resident.map((r) => r.path.length))
  const rows = report.resident.map((r) => {
    const cited =
      r.citedBy.length > 0
        ? `${c.dim}<- ${r.citedBy.join(', ')}${c.off}`
        : `${c.yellow}<- nothing in the graph anchors it${c.off}`
    const tag = r.citedBy.length > 0 ? `${c.green}[ok]  ${c.off}` : `${c.yellow}[warn]${c.off}`
    return `  ${tag} ${r.path.padEnd(width)}  ${c.dim}~${r.estimatedTokens} tok${c.off}  ${cited}`
  })

  return [header, ...rows]
}

function savedSection(report: SkillsReport, c: Palette): readonly string[] {
  const header =
    `${c.bold}Tier 2 - ${ATSKILLS_DIR}/${c.off} ` +
    `${c.dim}(${plural(report.saved.length, 'skill', 'skills')}, 0 tok - invoked by name)${c.off}`
  if (report.saved.length === 0) return [header, `  ${c.dim}none${c.off}`]
  return [header, ...report.saved.map((s) => `  ${c.dim}${s.path}${c.off}`)]
}

function notCountedSection(report: SkillsReport, c: Palette): readonly string[] {
  const lines: string[] = []

  for (const cloud of report.cloud) {
    lines.push(
      `  ${c.dim}@${cloud.address} (line ${cloud.lineNumber}) - a provider's copy; ` +
        `resident, but its size is not on disk to weigh${c.off}`,
    )
  }
  for (const entry of report.entries.filter((e) => e.unsupported)) {
    lines.push(
      `  ${c.yellow}${entry.raw} (line ${entry.lineNumber}) - a gitignore pattern; ` +
        `this reader matches literal paths only, so it is not counted${c.off}`,
    )
  }
  for (const u of report.unresolved) {
    lines.push(`  ${c.yellow}${u.address} (line ${u.lineNumber}) - ${u.reason}${c.off}`)
  }

  if (lines.length === 0) return []
  return [`${c.bold}Not counted${c.off}`, ...lines]
}

function suggestionSection(report: SkillsReport, c: Palette): readonly string[] {
  if (report.suggestions.length === 0) return []
  return [
    `${c.bold}Suggested${c.off} ${c.dim}- lines to add to ${AUTOTRIGGER_FILE} yourself.` +
      ` kb never writes that file.${c.off}`,
    ...report.suggestions.flatMap((s) => [`  ${c.dim}${s.comment}${c.off}`, `  ${s.line}`]),
  ]
}

/**
 * The whole report.
 *
 * A project with no `.atskills/` gets an invitation rather than an error: not adopting the
 * protocol is a legitimate state, and a tool that scolds about an unused feature is one
 * people learn to scroll past.
 */
export function renderSkills(report: SkillsReport, c: Palette): string {
  if (!report.present) {
    return [
      `${c.dim}kb skills: no ${ATSKILLS_DIR}/ in this repository.${c.off}`,
      '',
      `The @skills protocol delivers an agent skill in three tiers, and only the last`,
      `costs resident prompt tokens:`,
      `  reference  @skills:<path>          read at the point of use, nothing stored`,
      `  saved      @skills:<path>:save     a copy in ${ATSKILLS_DIR}/, git-tracked, 0 tok`,
      `  installed  @skills:<path>:install  one line in ${AUTOTRIGGER_FILE}`,
      '',
      `${c.dim}Create ${ATSKILLS_DIR}/ when you have a skill worth keeping. See`,
      `https://github.com/SylphAI-Inc/atskills${c.off}`,
    ].join('\n')
  }

  const sections: readonly (readonly string[])[] = [
    residentSection(report, c),
    savedSection(report, c),
    notCountedSection(report, c),
    suggestionSection(report, c),
  ]

  const body = sections
    .filter((s) => s.length > 0)
    .map((s) => s.join('\n'))
    .join('\n\n')

  const uncited =
    report.uncited.length > 0
      ? `\n\n${c.yellow}${plural(report.uncited.length, 'resident skill', 'resident skills')} ` +
        `no document anchors: ${report.uncited.join(', ')}.${c.off}\n` +
        `${c.dim}Anchor it from a work item or invariant (file:${ATSKILLS_DIR}/<path>), ` +
        `or drop the line. Advisory: this never fails the turn.${c.off}`
      : ''

  return `${body}${uncited}`
}
