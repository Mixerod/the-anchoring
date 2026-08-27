/**
 * The only place `kb` touches git.
 *
 * Injected as an argument everywhere it is used, for the same reason core takes its RNG
 * as a parameter: a command that shells out cannot be tested, and `kb done` is the one
 * command an agent will run on every unit of work.
 */

import { spawnSync } from 'node:child_process'

export type ChangedFiles = (root: string) => readonly string[]

/**
 * Files touched relative to HEAD: staged, unstaged, and untracked. Deliberately not
 * `HEAD~1` — the question `kb done` asks is "what is about to be committed", which is the
 * working tree, not the last commit.
 */
export const gitChangedFiles: ChangedFiles = (root) => {
  const run = (args: readonly string[]): readonly string[] => {
    const result = spawnSync('git', [...args], { cwd: root, encoding: 'utf8', timeout: 20_000 })
    if (result.error || result.status !== 0) return []
    return result.stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  }

  const tracked = run(['diff', '--name-only', 'HEAD'])
  const untracked = run(['ls-files', '--others', '--exclude-standard'])
  return [...new Set([...tracked, ...untracked])].sort()
}
