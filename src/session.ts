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

const SESSION_FILE = '.dicebound/session/current'

const WORK_ID = /^W-\d+$/

export function rememberWork(root: string, workId: string): void {
  if (!WORK_ID.test(workId)) return
  const path = join(root, SESSION_FILE)
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${workId}\n`)
  } catch {
    // A session note is a convenience. Losing it must never fail the command that
    // was actually asked for.
  }
}

export function recallWork(root: string): string | undefined {
  const path = join(root, SESSION_FILE)
  if (!existsSync(path)) return undefined
  try {
    const value = readFileSync(path, 'utf8').trim()
    return WORK_ID.test(value) ? value : undefined
  } catch {
    return undefined
  }
}
