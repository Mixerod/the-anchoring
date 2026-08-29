/**
 * The I/O half of `kb skills`.
 *
 * Exists so `skills.ts` stays pure — the same split `loader.ts` gives `store.ts` and
 * `brief-source.ts` gives `brief.ts`. This module reads and never writes: `.atskills/`
 * belongs to the host project and to the @skills protocol, and a tool that edits a file it
 * does not own is a tool that gets uninstalled.
 *
 * The walk follows the protocol's leaf rule: a folder holding `SKILL.md` is a skill and the
 * walk stops there, so a `SKILL.md` bundled inside a skill is that skill's file rather than
 * a second skill. Getting this wrong would over-count the budget, which is the one number
 * the command exists to report honestly.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parseFrontmatter } from './frontmatter.js'
import { ATSKILLS_DIR, AUTOTRIGGER_FILE, type SkillDoc, type SkillsInput } from './skills.js'
import type { AnchoringConfig } from './config.js'

const SKILL_FILE = 'SKILL.md'

/** Directories that are never skills, so the walk never descends into them. */
const SKIPPED = new Set(['.git', 'node_modules'])

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function exists(path: string): boolean {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * Name and description from a `SKILL.md`, or `undefined` when there is no usable frontmatter.
 *
 * A skill whose frontmatter will not parse is reported as a skill with an empty description
 * rather than dropped: it still occupies a slot, and a budget that omitted it would be
 * wrong in the direction that lets a cost hide.
 */
function readSkillDoc(root: string, relPath: string): SkillDoc {
  const fallbackName = relPath.split('/').pop() ?? relPath
  let text: string
  try {
    text = readFileSync(join(root, ATSKILLS_DIR, relPath, SKILL_FILE), 'utf8')
  } catch {
    return { path: relPath, name: fallbackName, description: '' }
  }

  const parsed = parseFrontmatter(text)
  if (!parsed.ok) return { path: relPath, name: fallbackName, description: '' }

  const name = parsed.data['name']
  const description = parsed.data['description']
  return {
    path: relPath,
    name: typeof name === 'string' && name.trim() !== '' ? name.trim() : fallbackName,
    description: typeof description === 'string' ? description.trim() : '',
  }
}

function walkSkills(absoluteBase: string, relPath: string, found: string[]): void {
  const absolute = relPath === '' ? absoluteBase : join(absoluteBase, relPath)

  if (exists(join(absolute, SKILL_FILE))) {
    // Leaf rule: this folder is a skill, and nothing below it is a second one.
    if (relPath !== '') found.push(relPath)
    return
  }

  let names: readonly string[]
  try {
    names = readdirSync(absolute)
  } catch {
    return
  }

  for (const name of [...names].sort()) {
    if (name.startsWith('.') || SKIPPED.has(name)) continue
    const child = relPath === '' ? name : `${relPath}/${name}`
    if (isDirectory(join(absoluteBase, child))) walkSkills(absoluteBase, child, found)
  }
}

/**
 * Read everything `kb skills` reports on.
 *
 * A project with no `.atskills/` is the common case and not a fault: `present: false` says
 * so, and the caller prints an invitation rather than an error.
 */
export function readSkillsInput(config: AnchoringConfig): SkillsInput {
  const base = join(config.root, ATSKILLS_DIR)
  if (!isDirectory(base)) return { present: false, skills: [] }

  const paths: string[] = []
  walkSkills(base, '', paths)

  let autotrigger: string | undefined
  try {
    autotrigger = readFileSync(join(config.root, AUTOTRIGGER_FILE), 'utf8')
  } catch {
    autotrigger = undefined
  }

  return {
    present: true,
    skills: paths.map((p) => readSkillDoc(config.root, p)),
    ...(autotrigger !== undefined ? { autotrigger } : {}),
  }
}
