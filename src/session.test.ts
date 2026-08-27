import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recallWork, rememberWork } from './session.js'
import { defaultConfig } from './config.js'

const scratch = (): string => mkdtempSync(join(tmpdir(), 'kb-session-'))
const conf = (root: string) => defaultConfig(root)

describe('session', () => {
  test('remembers a work id across calls', () => {
    const root = scratch()
    rememberWork(conf(root), 'W-112')

    expect(recallWork(conf(root))).toBe('W-112')
  })

  test('recalls nothing when no session has been opened', () => {
    expect(recallWork(conf(scratch()))).toBeUndefined()
  })

  test('overwrites rather than accumulating, so the last ctx wins', () => {
    const root = scratch()
    rememberWork(conf(root), 'W-1')
    rememberWork(conf(root), 'W-2')

    expect(recallWork(conf(root))).toBe('W-2')
  })

  test('refuses to store anything that is not a work id', () => {
    // The value is read back and passed on; storing arbitrary text would let a stray
    // write turn into a confusing report later.
    const root = scratch()
    rememberWork(conf(root), 'ADR-0003')

    expect(recallWork(conf(root))).toBeUndefined()
  })

  test('ignores a corrupted session file instead of propagating it', () => {
    const root = scratch()
    mkdirSync(join(root, '.anchor', 'session'), { recursive: true })
    writeFileSync(join(root, '.anchor', 'session', 'current'), 'not-an-id\n')

    expect(recallWork(conf(root))).toBeUndefined()
  })

  test('tolerates trailing whitespace, since the file is written with a newline', () => {
    const root = scratch()
    mkdirSync(join(root, '.anchor', 'session'), { recursive: true })
    writeFileSync(join(root, '.anchor', 'session', 'current'), '  W-42  \n\n')

    expect(recallWork(conf(root))).toBe('W-42')
  })
})
