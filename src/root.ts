/**
 * Locating the repository root and loading configuration from disk.
 *
 * Walks upward from the given directory. A configuration file takes precedence over
 * git, so a monorepo holding several anchored sub-projects inside one git repository
 * resolves to the nearest sub-project.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseConfig, defaultConfig, type ConfigResult } from './config.js'

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
