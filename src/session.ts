/**
 * Which work item this session is on.
 *
 * The Stop hook has to answer "did the agent record what it just did", and to do that it
 * needs to know *what* the agent was doing. Asking the agent to pass it would put the
 * remembering back on the agent, which is the thing that does not work. So `kb ctx` — the
 * command an agent already runs before starting — leaves a note, and the hook reads it.
 *
 * The note is derived state: gitignored, disposable, never a source of truth.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AnchoringConfig } from './config.js'

export function rememberWork(config: AnchoringConfig, workId: string): void {
  if (!config.kinds.WORK.idPattern.test(workId)) return
  const path = join(config.root, config.sessionFile)
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${workId}\n`)
  } catch {
    // A session note is a convenience. Losing it must never fail the command that
    // was actually asked for.
  }
}

export function recallWork(config: AnchoringConfig): string | undefined {
  const path = join(config.root, config.sessionFile)
  if (!existsSync(path)) return undefined
  try {
    const value = readFileSync(path, 'utf8').trim()
    return config.kinds.WORK.idPattern.test(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Any other note under `${kbRoot}/session/`, read and written as an opaque string.
 *
 * Opaque on purpose. The no-progress counter's *shape* is domain knowledge and lives in
 * `fingerprint.ts` with the rule that uses it; this file only moves bytes. That keeps infra
 * from importing the domain to store one of its records, and keeps the parser testable
 * without a filesystem — the same plan/apply split every other boundary here gets.
 *
 * `${kbRoot}/session/` is already gitignored and is already where ephemeral state lives.
 */
export function readSessionNote(config: AnchoringConfig, name: string): string | undefined {
  const path = join(config.root, config.kbRoot, 'session', name)
  if (!existsSync(path)) return undefined
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

export function writeSessionNote(config: AnchoringConfig, name: string, text: string): void {
  const path = join(config.root, config.kbRoot, 'session', name)
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, text)
  } catch {
    // Derived state. Losing it must never fail the command that was actually asked for.
  }
}
