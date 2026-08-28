import { describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { COLOUR, PLAIN, choosePalette, type ColourEnv } from './render.js'

const ESC = String.fromCharCode(27)

const env = (over: Partial<ColourEnv> = {}): ColourEnv => ({
  isTTY: true,
  noColorEnv: false,
  noColorFlag: false,
  colorFlag: false,
  ...over,
})

describe('choosePalette', () => {
  test('colours a terminal', () => {
    expect(choosePalette(env())).toBe(COLOUR)
  })

  test('drops colour when stdout is not a terminal', () => {
    // The defect this whole section exists for: ANSI into a pipe is tokens an agent pays
    // for and cannot use.
    expect(choosePalette(env({ isTTY: false }))).toBe(PLAIN)
  })

  test('honours NO_COLOR at any value, including empty and "0"', () => {
    // The published convention is *presence*, not truthiness. Reading `NO_COLOR=0` as
    // "yes colour" is the near-miss that looks correct in every manual test.
    expect(choosePalette(env({ noColorEnv: true }))).toBe(PLAIN)
  })

  test('--no-color drops colour on a terminal', () => {
    expect(choosePalette(env({ noColorFlag: true }))).toBe(PLAIN)
  })

  test('--color forces colour back on for a pipe into a pager', () => {
    expect(choosePalette(env({ isTTY: false, colorFlag: true }))).toBe(COLOUR)
    expect(choosePalette(env({ noColorEnv: true, colorFlag: true }))).toBe(COLOUR)
  })

  test('--no-color beats --color', () => {
    // An explicit refusal outranks an explicit request, so a script that hardcodes one can
    // still be overridden by the person running it.
    expect(choosePalette(env({ colorFlag: true, noColorFlag: true }))).toBe(PLAIN)
  })
})

/**
 * The test where the check must speak: a real process, a real pipe.
 *
 * `choosePalette` above is pure and could pass while the CLI never called it — which is
 * precisely the shape of the original defect, where `PLAIN` existed and production never
 * selected it.
 */
describe('the CLI, captured through a pipe', () => {
  const kb = (args: readonly string[], extraEnv: Readonly<Record<string, string>> = {}) =>
    spawnSync('node', ['--import', 'tsx', 'src/cli.ts', ...args], {
      encoding: 'utf8',
      timeout: 60_000,
      env: { ...process.env, ...extraEnv },
    })

  test('kb verify --strict emits no escape sequence', () => {
    const result = kb(['verify', '--strict'])

    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain(ESC)
    expect(result.stdout).toContain('kb verify:')
  })

  test('NO_COLOR=0 still means no colour', () => {
    const result = kb(['verify'], { NO_COLOR: '0' })

    expect(result.stdout).not.toContain(ESC)
  })

  test('--color forces escapes back on even through a pipe', () => {
    const result = kb(['verify', '--color'])

    expect(result.stdout).toContain(ESC)
  })

  test('kb brief never carries escapes, with or without --color', () => {
    // The bundle is written for a cache prefix. Colour would be paid for on every call.
    expect(kb(['brief', '--color']).stdout).not.toContain(ESC)
  })
})
