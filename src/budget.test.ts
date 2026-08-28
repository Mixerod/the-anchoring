import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checkBodyBudget } from './verify.js'
import { exitCodeFor } from './cli-verify.js'
import { parseConfig, DEFAULT_MAX_BODY_BYTES } from './config.js'
import { parseEntity } from './store.js'
import { run } from './cli.js'
import type { Entity } from './store.js'
import type { Finding } from './finding.js'

const entity = (bodyBytes?: number): Entity => ({
  id: 'INV-BIG',
  kind: 'INV',
  title: 'A big invariant',
  status: 'active',
  path: '.anchor/invariant/INV-BIG.md',
  links: {},
  fields: {},
  ...(bodyBytes !== undefined ? { bodyBytes } : {}),
})

describe('checkBodyBudget', () => {
  test('says nothing for a body within budget', () => {
    expect(checkBodyBudget(entity(100), 6000)).toEqual([])
    expect(checkBodyBudget(entity(6000), 6000)).toEqual([])
  })

  test('warns, naming the entity and the excess', () => {
    const [finding] = checkBodyBudget(entity(6500), 6000)

    expect(finding?.severity).toBe('warn')
    expect(finding?.where).toBe('INV-BIG · body')
    expect(finding?.message).toContain('6500 bytes')
    expect(finding?.message).toContain('500 over')
  })

  test('is advisory, which is what keeps it out of every exit code', () => {
    const [finding] = checkBodyBudget(entity(6500), 6000)

    expect(finding?.advisory).toBe(true)
  })

  test('says nothing when the body was never measured', () => {
    // "We did not look" and "it is within budget" are different facts. Merging them is how
    // a gate starts lying.
    expect(checkBodyBudget(entity(undefined), 6000)).toEqual([])
  })
})

describe('exitCodeFor', () => {
  const warn = (advisory = false): Finding => ({
    severity: 'warn',
    where: 'X',
    message: 'm',
    ...(advisory ? { advisory: true } : {}),
  })
  const error: Finding = { severity: 'error', where: 'X', message: 'm' }

  test('an ordinary warning fails --strict', () => {
    expect(exitCodeFor([warn()], true)).toBe(1)
    expect(exitCodeFor([warn()], false)).toBe(0)
  })

  test('an advisory warning never fails, strict or not', () => {
    expect(exitCodeFor([warn(true)], true)).toBe(0)
    expect(exitCodeFor([warn(true)], false)).toBe(0)
  })

  test('an error always fails', () => {
    expect(exitCodeFor([error], false)).toBe(1)
  })
})

describe('config', () => {
  test('defaults maxBodyBytes to 6000', () => {
    const result = parseConfig('/repo', {})

    expect(result.ok && result.config.maxBodyBytes).toBe(DEFAULT_MAX_BODY_BYTES)
  })

  test('accepts a declared budget and rejects a nonsensical one', () => {
    expect(parseConfig('/repo', { maxBodyBytes: 1200 })).toMatchObject({ ok: true })
    expect(parseConfig('/repo', { maxBodyBytes: 0 })).toMatchObject({ ok: false })
    expect(parseConfig('/repo', { maxBodyBytes: 'big' })).toMatchObject({ ok: false })
  })
})

describe('parseEntity measures the body, not the frontmatter', () => {
  test('counts only what follows the fence', () => {
    const config = parseConfig('/repo', {})
    if (!config.ok) throw new Error('fixture config invalid')
    const text = ['---', 'id: INV-X', 'title: T', 'status: active', '---', 'abcde'].join('\n')

    const parsed = parseEntity(config.config, '.anchor/invariant/INV-X.md', 'INV', text)

    expect('bodyBytes' in parsed && parsed.bodyBytes).toBe(5)
  })
})

/** The test where the check must speak — and must still let the build through. */
describe('kb verify --strict with an over-budget body', () => {
  function fixture(bodyBytes: number): string {
    const root = mkdtempSync(join(tmpdir(), 'kb-budget-'))
    const write = (path: string, body: string) => {
      const full = join(root, path)
      mkdirSync(dirname(full), { recursive: true })
      writeFileSync(full, body)
    }
    write('anchoring.config.json', JSON.stringify({ symbolIndex: 'none', maxBodyBytes: 500 }))
    write(
      '.anchor/invariant/INV-BIG.md',
      ['---', 'id: INV-BIG', 'title: Verbose', 'status: active', '---', 'x'.repeat(bodyBytes)].join(
        '\n',
      ),
    )
    return root
  }

  const invoke = (argv: readonly string[], root: string) => {
    const out: string[] = []
    const code = run([...argv, '--no-colour'], (t) => out.push(t), () => {}, root, () => [])
    return { code, out: out.join('\n') }
  }

  test('warns about the oversized body', () => {
    const result = invoke(['verify'], fixture(2000))

    expect(result.out).toContain('INV-BIG · body')
    expect(result.out).toContain('over the 500-byte budget')
  })

  test('--strict still exits 0', () => {
    // Not a stylistic preference. A build that goes red because a document is verbose is a
    // build people learn to bypass, and the checks that matter get bypassed with it.
    const result = invoke(['verify', '--strict'], fixture(2000))

    expect(result.code).toBe(0)
    expect(result.out).toContain('over the 500-byte budget')
  })

  test('stays silent for a body inside the budget', () => {
    const result = invoke(['verify', '--strict'], fixture(100))

    expect(result.code).toBe(0)
    expect(result.out).not.toContain('budget')
  })
})
