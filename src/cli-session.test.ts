import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { run } from './cli.js'

/** Each test gets its own repo: the session note is per-root state by design. */
function fixture(docs: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'kb-clisession-'))
  for (const [path, body] of Object.entries(docs)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return root
}

const doc = (fields: Readonly<Record<string, string>>): string =>
  ['---', ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`), '---', ''].join('\n')

function invoke(argv: readonly string[], root: string, files: readonly string[] = []) {
  const out: string[] = []
  const err: string[] = []
  const code = run(
    [...argv, '--no-colour'],
    (t) => out.push(t),
    (t) => err.push(t),
    root,
    () => files,
  )
  return { code, out: out.join('\n'), err: err.join('\n') }
}

const withWork = (id: string, status = 'doing') =>
  fixture({ [`.anchor/work/${id}.md`]: doc({ id, title: 'Remembered work', status }) })

describe('kb done, with no id given', () => {
  test('exits 2 with usage when nothing has been claimed', () => {
    const result = invoke(['done'], withWork('W-1'))

    expect(result.code).toBe(2)
    expect(result.err).toContain('usage: kb done')
  })

  test('stays silent under --check for a diff that touches no source', () => {
    // The Stop hook runs on every turn, including turns that have nothing to do with a
    // work item. Anything printed here would train the user to disable the hook.
    const result = invoke(['done', '--check'], withWork('W-1'), ['README.md', 'package.json'])

    expect(result.code).toBe(0)
    expect(result.out).toBe('')
  })

  test('breaks that silence when source changed and nothing is claimed', () => {
    // This case used to assert silence, with `packages/sim/src/rng.ts` in the diff. INC-0001
    // is what that assertion cost: opening no work item bypassed every gate, and six files
    // landed in `apps/` with nothing said. The silence above is still right; this is not.
    const result = invoke(['done', '--check'], withWork('W-1'), ['packages/sim/src/rng.ts'])

    expect(result.code).toBe(0) // still never fails the turn
    expect(result.out).toContain('packages/sim/src/rng.ts')
    expect(result.out).toContain('kb ctx')
  })

  test('falls back to the item kb ctx last opened, which is what lets the hook run bare', () => {
    const root = withWork('W-77')
    invoke(['ctx', 'W-77'], root)

    expect(invoke(['done', '--check'], root).out).toContain('W-77')
  })

  test('does not remember a work item that does not exist', () => {
    const root = withWork('W-1')
    invoke(['ctx', 'W-404'], root)

    expect(invoke(['done', '--check'], root).out).toBe('')
  })

  test('an explicit id still wins over the remembered one', () => {
    const root = fixture({
      '.anchor/work/W-77.md': doc({ id: 'W-77', title: 'Remembered', status: 'doing' }),
      '.anchor/work/W-88.md': doc({ id: 'W-88', title: 'Explicit', status: 'doing' }),
    })
    invoke(['ctx', 'W-77'], root)

    expect(invoke(['done', 'W-88', '--check'], root).out).toContain('W-88')
  })
})
