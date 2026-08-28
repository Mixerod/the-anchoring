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
 * The pure half of `gitChangedFiles`: everything except the two spawns.
 *
 * Takes the raw stdout of `git diff --name-only HEAD` and of
 * `git ls-files --others --exclude-standard`, and returns the union, de-duplicated
 * (a file can be reported by both) and sorted, with blank lines dropped. Extracted so the
 * merge rule is testable without a repository, which is the treatment every other I/O
 * boundary in this codebase already gets.
 */
export function parseChangedFiles(
  trackedStdout: string,
  untrackedStdout: string,
): readonly string[] {
  const lines = (raw: string): readonly string[] =>
    raw.split('\n').map((line) => line.trim()).filter(Boolean)

  return [...new Set([...lines(trackedStdout), ...lines(untrackedStdout)])].sort()
}

/**
 * Files touched relative to HEAD: staged, unstaged, and untracked. Deliberately not
 * `HEAD~1` — the question `kb done` asks is "what is about to be committed", which is the
 * working tree, not the last commit.
 */
/* c8 ignore start -- spawn-and-delegate; the merge rule it delegates to is parseChangedFiles */
export const gitChangedFiles: ChangedFiles = (root) => {
  const run = (args: readonly string[]): string => {
    const result = spawnSync('git', [...args], { cwd: root, encoding: 'utf8', timeout: 20_000 })
    if (result.error || result.status !== 0) return ''
    return result.stdout
  }

  return parseChangedFiles(
    run(['diff', '--name-only', 'HEAD']),
    run(['ls-files', '--others', '--exclude-standard']),
  )
}
/* c8 ignore stop */

/**
 * Files changed since a git ref, or `undefined` when git could not tell.
 *
 * The distinction is the whole point. A ref that does not exist and a ref with no changes
 * since it are different facts, and collapsing them would make `kb verify --since typo`
 * print "no entities changed" and exit 0 — a gate reporting success having checked nothing.
 * That is INC-0001's shape, and this repository has already paid for it once.
 */
export type ChangedSince = (root: string, ref: string) => readonly string[] | undefined

/* c8 ignore start -- spawn-and-delegate; the merge rule it delegates to is parseChangedFiles */
export const gitChangedSince: ChangedSince = (root, ref) => {
  const result = spawnSync('git', ['diff', '--name-only', ref], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20_000,
  })
  if (result.error || result.status !== 0) return undefined
  return parseChangedFiles(result.stdout, '')
}
/* c8 ignore stop */

/**
 * The pure half of `gitIsDirty`: whether `git status --porcelain` reported anything.
 *
 * A non-zero exit is reported as *not* dirty by the caller, deliberately: "git failed" and
 * "the tree has changes" are different facts, and only the caller knows whether it may
 * proceed on the first.
 */
export function parseDirty(statusStdout: string): boolean {
  return statusStdout.split('\n').some((line) => line.trim() !== '')
}

export type IsDirty = (root: string) => boolean | undefined

/**
 * Whether a repository has uncommitted changes. `undefined` means git could not tell —
 * not a directory, not a repository, git missing. The caller must refuse on `undefined`
 * rather than assume clean: writing into somebody's work in progress is how a helpful tool
 * becomes an unwelcome one.
 */
/* c8 ignore start -- spawn-and-delegate; the decision it delegates to is parseDirty */
export const gitIsDirty: IsDirty = (root) => {
  const result = spawnSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20_000,
  })
  if (result.error || result.status !== 0) return undefined
  return parseDirty(result.stdout)
}
/* c8 ignore stop */
