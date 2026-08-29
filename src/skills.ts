/**
 * `kb skills` — what the project's agent skills cost, and what the graph says about it.
 *
 * The @skills protocol (github.com/SylphAI-Inc/atskills) delivers a skill in one of three
 * tiers, and only the most expensive one touches the prompt: a reference costs nothing and
 * evaporates, a copy saved into `.atskills/` costs nothing between messages, and a line in
 * `.atskills/.autotrigger` buys auto-triggering at the price of permanent residency. The
 * budget for that last tier is small — the protocol's own recommendation is under ten — and
 * it is spent one line at a time by whoever is in a hurry.
 *
 * This module answers the question the protocol leaves open: *which of those lines has the
 * repository actually justified?* An entity earns a skill its residency by anchoring it,
 * `file:.atskills/<path>`, exactly as it anchors any other file. No new anchor form is
 * introduced: `anchors.ts` says two forms and deliberately no third, and a skill folder is
 * an ordinary path on disk, so `file:` already reaches it and `anchorCovers` already gets
 * the trailing slash right.
 *
 * What this module never does is write. `.atskills/` belongs to the host project and to the
 * protocol, not to this tool, so every conclusion here leaves as a printed line for a human
 * to paste — the same discipline `kb guards` follows for a linter config. A tool that edits
 * a file it does not own is a tool that gets uninstalled.
 *
 * Pure module: no filesystem I/O, no clock. The reading half is `skills-source.ts`.
 */

import { anchorCovers } from './anchors.js'
import type { Entity } from './store.js'

/**
 * Bytes per token, approximately, for English prose in a BPE tokenizer.
 *
 * A rule of thumb and nothing more. This tool calls no tokenizer and no network, so every
 * token figure it prints is arithmetic on a byte count and is labelled an estimate with its
 * divisor shown. `render-stats.ts` states the same reasoning at length for the corpus
 * budget; the constant is duplicated rather than imported because that module sits in the
 * app layer and this one is domain, and the dependency may not point that way.
 */
export const BYTES_PER_TOKEN_ESTIMATE = 4

/** Where `.atskills/` sits, relative to the repository root. The protocol fixes this name. */
export const ATSKILLS_DIR = '.atskills'

/** The one file that costs resident prompt tokens. */
export const AUTOTRIGGER_FILE = `${ATSKILLS_DIR}/.autotrigger`

export interface SkillDoc {
  /** Path of the skill directory relative to `.atskills/`, always forward-slashed. */
  readonly path: string
  readonly name: string
  readonly description: string
}

export interface SkillsInput {
  /** False when the project has no `.atskills/` at all — the common case, and not a fault. */
  readonly present: boolean
  readonly skills: readonly SkillDoc[]
  /** Raw text of `.autotrigger`, absent when the file does not exist. */
  readonly autotrigger?: string | undefined
}

export interface TriggerEntry {
  readonly raw: string
  /** 1-based, so a reader can find the line in an editor. */
  readonly lineNumber: number
  /** The address with `@` and any trailing slash removed. */
  readonly address: string
  readonly source: 'local' | 'cloud'
  /** True when the line ended in `/` and therefore takes everything beneath it. */
  readonly directory: boolean
  /** True when an earlier line named the same address. The protocol loads it once. */
  readonly duplicate: boolean
  /**
   * True for a gitignore pattern this reader does not implement.
   *
   * The protocol gives plain lines full gitignore semantics, globs and `!` negation
   * included. Implementing that needs a matcher, and this tool adds no dependency for a
   * report. Saying so is the honest option: a pattern silently read as a literal path would
   * under-report the budget, which is the one number the command exists to get right.
   */
  readonly unsupported: boolean
}

export interface ResidentSkill extends SkillDoc {
  readonly estimatedTokens: number
  /** The `.autotrigger` line that made it resident. */
  readonly via: string
  /** Ids of entities anchoring this skill. Empty means nothing in the graph justifies it. */
  readonly citedBy: readonly string[]
}

export interface UnresolvedLine {
  readonly address: string
  readonly lineNumber: number
  readonly reason: string
}

export interface CloudLine {
  readonly address: string
  readonly lineNumber: number
}

export interface SuggestedLine {
  readonly address: string
  readonly citedBy: readonly string[]
  /** The exact line to paste into `.autotrigger`. */
  readonly line: string
  /** The comment line to paste above it, naming why. */
  readonly comment: string
}

export interface SkillsReport {
  readonly present: boolean
  readonly entries: readonly TriggerEntry[]
  readonly resident: readonly ResidentSkill[]
  readonly residentTokens: number
  /** In `.atskills/` but not resident: Tier 2, free between messages. */
  readonly saved: readonly SkillDoc[]
  /** Lines following a provider's copy. Their cost is real but cannot be weighed offline. */
  readonly cloud: readonly CloudLine[]
  readonly unresolved: readonly UnresolvedLine[]
  /** Paths of resident skills no entity anchors. The advisory this command exists for. */
  readonly uncited: readonly string[]
  readonly suggestions: readonly SuggestedLine[]
}

const GLOB_CHARS = /[*?[\]]/

function isUnsupported(address: string, negated: boolean): boolean {
  return negated || GLOB_CHARS.test(address)
}

/**
 * Parse `.autotrigger` into entries, one per meaningful line.
 *
 * Comments and blank lines are dropped rather than carried as entries: they are the file's
 * prose, and a budget that counted them would be wrong in the direction that matters.
 */
export function parseAutotrigger(text: string): readonly TriggerEntry[] {
  const entries: TriggerEntry[] = []
  const seen = new Set<string>()

  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? ''
    const trimmed = raw.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue

    const negated = trimmed.startsWith('!')
    const withoutBang = negated ? trimmed.slice(1) : trimmed
    const cloud = withoutBang.startsWith('@')
    const withoutAt = cloud ? withoutBang.slice(1) : withoutBang
    const directory = withoutAt.endsWith('/')
    const address = directory ? withoutAt.slice(0, -1) : withoutAt

    entries.push({
      raw: trimmed,
      lineNumber: i + 1,
      address,
      source: cloud ? 'cloud' : 'local',
      directory,
      duplicate: seen.has(address),
      unsupported: isUnsupported(address, negated),
    })
    seen.add(address)
  }

  return entries
}

function matches(entry: TriggerEntry, skill: SkillDoc): boolean {
  if (entry.directory) return anchorCovers(`${entry.address}/`, skill.path)
  return entry.address === skill.path
}

function estimateTokens(skill: SkillDoc): number {
  return Math.ceil((skill.name.length + skill.description.length) / BYTES_PER_TOKEN_ESTIMATE)
}

/**
 * Which entities anchor a skill.
 *
 * The anchor is an ordinary `file:` reference to the skill's directory under `.atskills/`,
 * so a directory anchor covers everything beneath it exactly as it does for source. Ids are
 * returned in the order the entities were given, which the caller sorts.
 */
function citationsFor(skill: SkillDoc, entities: readonly Entity[]): readonly string[] {
  const target = `${ATSKILLS_DIR}/${skill.path}`
  const cited: string[] = []

  for (const entity of entities) {
    const anchored = Object.values(entity.links)
      .flat()
      .some((raw) => {
        const value = raw.trim()
        if (!value.startsWith('file:')) return false
        return anchorCovers(value.slice('file:'.length).trim(), target)
      })
    if (anchored) cited.push(entity.id)
  }

  return cited
}

interface Residency {
  /** Skill path → the raw `.autotrigger` line that made it resident. */
  readonly byPath: ReadonlyMap<string, string>
  /** Line numbers that matched at least one skill. */
  readonly matchedLines: ReadonlySet<number>
}

/**
 * Which lines put which skills in the prompt.
 *
 * A cloud line names no local skill, a duplicate loads nothing a previous line did not
 * already load, and an unsupported pattern is not matched at all rather than guessed at.
 */
function resolveResidency(
  entries: readonly TriggerEntry[],
  skills: readonly SkillDoc[],
): Residency {
  const byPath = new Map<string, string>()
  const matchedLines = new Set<number>()

  for (const entry of entries) {
    if (entry.source === 'cloud' || entry.duplicate || entry.unsupported) continue
    for (const skill of skills) {
      if (!matches(entry, skill)) continue
      matchedLines.add(entry.lineNumber)
      // First line wins the attribution: a skill loads once however many lines name it.
      if (!byPath.has(skill.path)) byPath.set(skill.path, entry.raw)
    }
  }

  return { byPath, matchedLines }
}

/** Local lines that matched nothing. Reported rather than dropped: a line that loads nothing
 * is the failure mode the protocol calls out — nothing says so at the point of use. */
function unresolvedLines(
  entries: readonly TriggerEntry[],
  matchedLines: ReadonlySet<number>,
): readonly UnresolvedLine[] {
  return entries
    .filter(
      (e) => e.source === 'local' && !e.duplicate && !e.unsupported && !matchedLines.has(e.lineNumber),
    )
    .map((e) => ({
      address: e.address,
      lineNumber: e.lineNumber,
      reason: `no skill at ${ATSKILLS_DIR}/${e.address}`,
    }))
}

/**
 * Saved skills the graph already anchors, as lines to paste.
 *
 * A skill nothing cites is deliberately not suggested: residency is earned by a document
 * saying why, and a tool that suggests otherwise is one that fills the budget by itself.
 */
function suggestLines(
  saved: readonly SkillDoc[],
  citations: ReadonlyMap<string, readonly string[]>,
): readonly SuggestedLine[] {
  return saved
    .map((skill) => ({ skill, citedBy: citations.get(skill.path) ?? [] }))
    .filter((s) => s.citedBy.length > 0)
    .map(({ skill, citedBy }) => ({
      address: skill.path,
      citedBy,
      line: skill.path,
      comment: `# cited by ${citedBy.join(', ')}`,
    }))
}

/**
 * Weigh the project's skill delivery against what the intent graph justifies.
 *
 * Pure: every input is an argument, and the only output is a report. Nothing here decides
 * to write a line — `suggestions` is text for a human to paste, by design.
 */
export function planSkills(input: SkillsInput, entities: readonly Entity[]): SkillsReport {
  const entries = input.autotrigger === undefined ? [] : parseAutotrigger(input.autotrigger)
  const skills = [...input.skills].sort((a, b) => a.path.localeCompare(b.path))

  const { byPath, matchedLines } = resolveResidency(entries, skills)

  const citations = new Map<string, readonly string[]>()
  for (const skill of skills) citations.set(skill.path, citationsFor(skill, entities))

  const resident: ResidentSkill[] = []
  const saved: SkillDoc[] = []
  for (const skill of skills) {
    const via = byPath.get(skill.path)
    if (via === undefined) {
      saved.push(skill)
      continue
    }
    resident.push({
      ...skill,
      estimatedTokens: estimateTokens(skill),
      via,
      citedBy: citations.get(skill.path) ?? [],
    })
  }

  return {
    present: input.present,
    entries,
    resident,
    residentTokens: resident.reduce((sum, r) => sum + r.estimatedTokens, 0),
    saved,
    cloud: entries
      .filter((e) => e.source === 'cloud' && !e.duplicate)
      .map((e) => ({ address: e.address, lineNumber: e.lineNumber })),
    unresolved: unresolvedLines(entries, matchedLines),
    uncited: resident.filter((r) => r.citedBy.length === 0).map((r) => r.path),
    suggestions: suggestLines(saved, citations),
  }
}
