import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { isDirectlyInvoked, run } from './cli.js'
import { parseChangedFiles } from './git.js'

function fixture(docs: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'kb-cli-'))
  for (const [path, body] of Object.entries(docs)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return root
}

const CLEAN = fixture({
  'src/costs.ts': 'export const cost = 2\n',
  'docs/adr/0003-tempo.md':
    '---\nid: ADR-0003\ntitle: Tempo Pool\nstatus: accepted\ngoverns:\n  - file:src/costs.ts\n---\n',
})

const BROKEN = fixture({
  'docs/adr/0003-tempo.md':
    '---\nid: ADR-0003\ntitle: Tempo Pool\nstatus: accepted\ngoverns:\n  - file:src/gone.ts\n---\n',
})

const UNINDEXED_SYMBOL = fixture({
  'docs/adr/0003-tempo.md':
    '---\nid: ADR-0003\ntitle: Tempo Pool\nstatus: accepted\ngoverns:\n  - sym:calculateCost\n---\n',
})

function invoke(argv: readonly string[], root: string) {
  const out: string[] = []
  const err: string[] = []
  const code = run([...argv, '--no-colour'], (t) => out.push(t), (t) => err.push(t), root)
  return { code, out: out.join('\n'), err: err.join('\n') }
}

describe('kb verify', () => {
  test('exits 0 and says clean when every claim holds', () => {
    const result = invoke(['verify'], CLEAN)

    expect(result.code).toBe(0)
    expect(result.out).toContain('kb verify: clean')
  })

  test('exits 1 when a claim about the code is false', () => {
    const result = invoke(['verify'], BROKEN)

    expect(result.code).toBe(1)
    expect(result.out).toContain('file:src/gone.ts')
  })

  test('exits 0 on warnings by default, so an unindexed repo is still usable', () => {
    expect(invoke(['verify'], UNINDEXED_SYMBOL).code).toBe(0)
  })

  test('exits 1 on warnings under --strict, which is what CI runs', () => {
    expect(invoke(['verify', '--strict'], UNINDEXED_SYMBOL).code).toBe(1)
  })
})

describe('kb why', () => {
  test('answers for a code path', () => {
    const result = invoke(['why', 'src/costs.ts'], CLEAN)

    expect(result.code).toBe(0)
    expect(result.out).toContain('ADR-0003')
  })

  test('answers for an entity id', () => {
    expect(invoke(['why', 'ADR-0003'], CLEAN).out).toContain('Tempo Pool')
  })

  test('exits 2 with usage when no target is given', () => {
    const result = invoke(['why'], CLEAN)

    expect(result.code).toBe(2)
    expect(result.err).toContain('usage: kb why')
  })
})

describe('kb, no command', () => {
  test('prints usage and exits 0 for --help', () => {
    const result = invoke(['--help'], CLEAN)

    expect(result.code).toBe(0)
    expect(result.err).toContain('the intent graph over this repository')
  })

  test('exits 2 for an unknown command', () => {
    expect(invoke(['frobnicate'], CLEAN).code).toBe(2)
  })
})

const WORK = fixture({
  'src/tempo/costs.ts': 'export const cost = 2\n',
  'docs/adr/0003-tempo.md':
    '---\nid: ADR-0003\ntitle: Tempo Pool\nstatus: accepted\n' +
    'governs:\n  - file:src/tempo\n---\n',
  '.anchor/work/W-112.md':
    '---\nid: W-112\ntitle: Tune knight leap cost\nstatus: doing\n' +
    'implements:\n  - ADR-0003\n---\n',
})

function invokeWith(argv: readonly string[], root: string, files: readonly string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = run([...argv, '--no-colour'], (t) => out.push(t), (t) => err.push(t), root, () => files)
  return { code, out: out.join('\n'), err: err.join('\n') }
}

describe('kb ctx', () => {
  test('renders the bundle and exits 0', () => {
    const result = invokeWith(['ctx', 'W-112'], WORK, [])

    expect(result.code).toBe(0)
    expect(result.out).toContain('ADR-0003')
  })

  test('exits 1 for an unknown work item, so a typo does not look like success', () => {
    expect(invokeWith(['ctx', 'W-404'], WORK, []).code).toBe(1)
  })

  test('exits 2 with usage when no id is given', () => {
    const result = invokeWith(['ctx'], WORK, [])

    expect(result.code).toBe(2)
    expect(result.err).toContain('usage: kb ctx')
  })
})

describe('kb done', () => {
  test('exits 1 when something still needs recording', () => {
    const result = invokeWith(['done', 'W-112'], WORK, ['packages/sim/src/rng.ts'])

    expect(result.code).toBe(1)
    expect(result.out).toContain('packages/sim/src/rng.ts')
  })

  test('exits 0 under --check, so a hook reports without failing the turn', () => {
    const result = invokeWith(['done', 'W-112', '--check'], WORK, ['packages/sim/src/rng.ts'])

    expect(result.code).toBe(0)
    expect(result.out).toContain('not closed yet')
  })
})

describe('parseChangedFiles (T13d)', () => {
  test('staged output only', () => {
    expect(parseChangedFiles('src/a.ts\nsrc/b.ts\n', '')).toEqual(['src/a.ts', 'src/b.ts'])
  })

  test('untracked output only', () => {
    expect(parseChangedFiles('', 'docs/new.md\n')).toEqual(['docs/new.md'])
  })

  test('both are merged', () => {
    expect(parseChangedFiles('src/a.ts\n', 'src/z.ts\n')).toEqual(['src/a.ts', 'src/z.ts'])
  })

  test('a file reported by both appears once', () => {
    expect(parseChangedFiles('src/a.ts\n', 'src/a.ts\n')).toEqual(['src/a.ts'])
  })

  test('blank and whitespace-only lines are dropped', () => {
    expect(parseChangedFiles('src/a.ts\n\n   \n', '\n')).toEqual(['src/a.ts'])
  })

  test('the result is sorted, whatever order git printed', () => {
    expect(parseChangedFiles('src/z.ts\nsrc/a.ts\n', 'src/m.ts\n')).toEqual([
      'src/a.ts',
      'src/m.ts',
      'src/z.ts',
    ])
  })

  test('two empty outputs are an empty list, not a list with one empty string', () => {
    expect(parseChangedFiles('', '')).toEqual([])
  })
})

describe('isDirectlyInvoked (INC-0002: the CLI that exited 0 having done nothing)', () => {
  const MODULE = resolve('/repo/dist/cli.js')

  test('true when argv[1] is literally this module', () => {
    expect(isDirectlyInvoked(MODULE, MODULE, (p) => p)).toBe(true)
  })

  test('true when argv[1] is a symlink into this module — the case that was broken', () => {
    // What a package manager actually produces: node_modules/<pkg> is a link, and Node
    // resolves `import.meta.url` to the real file. The literal comparison fails here, and
    // the CLI silently exited 0 having checked nothing.
    const link = resolve('/adopter/node_modules/the-anchoring/dist/cli.js')
    const realpath = (p: string) => (p === link ? MODULE : p)

    expect(isDirectlyInvoked(link, MODULE, realpath)).toBe(true)
  })

  test('false when argv[1] is a different program, symlinks resolved', () => {
    expect(isDirectlyInvoked(resolve('/repo/dist/other.js'), MODULE, (p) => p)).toBe(false)
  })

  test('false when there is no argv[1] at all', () => {
    expect(isDirectlyInvoked(undefined, MODULE, (p) => p)).toBe(false)
    expect(isDirectlyInvoked('', MODULE, (p) => p)).toBe(false)
  })

  test('the literal match short-circuits, so realpath is not consulted at all', () => {
    let calls = 0
    const counting = (p: string): string => {
      calls += 1
      return p
    }
    expect(isDirectlyInvoked(MODULE, MODULE, counting)).toBe(true)
    expect(calls).toBe(0)
  })

  test('realPath itself swallows an unresolvable path rather than throwing', async () => {
    const { realPath } = await import('./root.js')
    const missing = resolve('/definitely/not/here/cli.js')
    expect(realPath(missing)).toBe(missing)
  })
})
