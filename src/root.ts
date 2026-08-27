/**
 * Locating the repository root.
 *
 * Walks upward from the given directory. A configuration file takes precedence over
 * git, so a monorepo holding several anchored sub-projects inside one git repository
 * resolves to the nearest sub-project.
 */

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

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
