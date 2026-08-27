/**
 * Locating the repository root and loading configuration from disk.
 *
 * Walks upward from the given directory. A configuration file takes precedence over
 * git, so a monorepo holding several anchored sub-projects inside one git repository
 * resolves to the nearest sub-project.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseConfig, defaultConfig, type ConfigResult } from './config.js'

/**
 * A path with every symlink resolved, falling back to the path itself when it cannot be.
 *
 * Lives here rather than in `cli.ts` because this is a declared I/O module and `cli.ts` is
 * not; `cli.ts` takes it as an argument, like every other I/O boundary in this codebase.
 */
/* c8 ignore next 7 */
export const realPath = (path: string): string => {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

export function findRepoRoot(startDir: string): string | undefined {
  // Pass 1: look for anchoring.config.json
  let current = resolve(startDir)
  while (true) {
    if (existsSync(join(current, 'anchoring.config.json'))) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  // Pass 2: fallback to .git (directory or worktree file)
  current = resolve(startDir)
  while (true) {
    if (existsSync(join(current, '.git'))) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  return undefined
}

export function loadConfig(root: string): ConfigResult {
  const configPath = join(root, 'anchoring.config.json')
  if (!existsSync(configPath)) {
    return { ok: true, config: defaultConfig(root) }
  }

  let text: string
  try {
    text = readFileSync(configPath, 'utf8')
  } catch (err) {
    return {
      ok: false,
      problems: [`anchoring.config.json: unreadable: ${(err as Error).message}`],
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    return {
      ok: false,
      problems: [`anchoring.config.json: invalid JSON: ${(err as Error).message}`],
    }
  }

  return parseConfig(root, parsed)
}
