import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findRepoRoot } from './root.js'
import { run } from './cli.js'

function makeTemp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('findRepoRoot', () => {
  test('finds a directory containing anchoring.config.json', () => {
    const dir = makeTemp('kb-root-config-')
    writeFileSync(join(dir, 'anchoring.config.json'), '{}')

    expect(findRepoRoot(dir)).toBe(dir)
  })

  test('finds it from a nested subdirectory', () => {
    const root = makeTemp('kb-root-nested-')
    writeFileSync(join(root, 'anchoring.config.json'), '{}')
    const deep = join(root, 'packages', 'core', 'src')
    mkdirSync(deep, { recursive: true })

    expect(findRepoRoot(deep)).toBe(root)
  })

  test('falls back to a directory containing .git as a directory', () => {
    const root = makeTemp('kb-root-gitdir-')
    mkdirSync(join(root, '.git'))
    const deep = join(root, 'src')
    mkdirSync(deep, { recursive: true })

    expect(findRepoRoot(deep)).toBe(root)
  })

  test('falls back to a directory containing .git as a file (worktree)', () => {
    const root = makeTemp('kb-root-worktree-')
    writeFileSync(join(root, '.git'), 'gitdir: /path/to/main/.git/worktrees/wt\n')
    const deep = join(root, 'src')
    mkdirSync(deep, { recursive: true })

    expect(findRepoRoot(deep)).toBe(root)
  })

  test('prefers a nearer anchoring.config.json over a further .git', () => {
    const gitRoot = makeTemp('kb-root-monorepo-')
    mkdirSync(join(gitRoot, '.git'))
    const subProject = join(gitRoot, 'packages', 'sub')
    mkdirSync(subProject, { recursive: true })
    writeFileSync(join(subProject, 'anchoring.config.json'), '{}')
    const nested = join(subProject, 'src')
    mkdirSync(nested, { recursive: true })

    expect(findRepoRoot(nested)).toBe(subProject)
  })

  test('returns undefined in a temp directory with neither', () => {
    const empty = makeTemp('kb-root-empty-')
    const deep = join(empty, 'a', 'b')
    mkdirSync(deep, { recursive: true })

    expect(findRepoRoot(deep)).toBeUndefined()
  })
})

describe('cli without explicit root', () => {
  test('prints error and exits 2 when not inside a repository', () => {
    const empty = makeTemp('kb-empty-cli-')
    const cwd = process.cwd()
    try {
      process.chdir(empty)
      const out: string[] = []
      const err: string[] = []
      const code = run(['verify'], (t) => out.push(t), (t) => err.push(t))

      expect(code).toBe(2)
      expect(err.join('\n')).toContain(
        'kb: not inside a repository. Run `kb init` at the root of your project first.',
      )
    } finally {
      process.chdir(cwd)
    }
  })
})
