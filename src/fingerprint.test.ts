import { describe, expect, test } from 'vitest'
import {
  fingerprintFindings,
  NO_PROGRESS_RUNS,
  parseProgress,
  serialiseProgress,
  trackProgress,
  type ProgressState,
} from './fingerprint.js'
import { fnv1a } from './fnv.js'
import type { Finding } from './finding.js'

const finding = (where: string, message = 'is wrong'): Finding => ({
  severity: 'error',
  where,
  message,
})

const A = finding('ADR-0001 · governs')
const B = finding('INV-PURE-CORE · enforced_by')

describe('fingerprintFindings', () => {
  test('is stable across runs', () => {
    expect(fingerprintFindings([A, B])).toBe(fingerprintFindings([A, B]))
  })

  test('ignores order — the same problems in a different order are no progress', () => {
    expect(fingerprintFindings([A, B])).toBe(fingerprintFindings([B, A]))
  })

  test('changes when a finding is fixed', () => {
    expect(fingerprintFindings([A])).not.toBe(fingerprintFindings([A, B]))
  })

  test('changes when a message changes but the location does not', () => {
    expect(fingerprintFindings([finding('X', 'one')])).not.toBe(
      fingerprintFindings([finding('X', 'two')]),
    )
  })

  test('is a 16-character hex digest', () => {
    expect(fingerprintFindings([A])).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('fnv1a', () => {
  test('is deterministic and fixed width', () => {
    expect(fnv1a('the-anchoring')).toBe(fnv1a('the-anchoring'))
    expect(fnv1a('')).toMatch(/^[0-9a-f]{16}$/)
    expect(fnv1a('a')).not.toBe(fnv1a('b'))
  })
})

describe('trackProgress — the case where it must speak', () => {
  const fp = fingerprintFindings([A])

  test('warns on the third consecutive run with an identical finding set', () => {
    let state: ProgressState | undefined
    const warnings: (string | undefined)[] = []

    for (let i = 0; i < NO_PROGRESS_RUNS; i++) {
      const report = trackProgress(state, fp, 1)
      state = report.state
      warnings.push(report.warning)
    }

    expect(warnings[0]).toBeUndefined()
    expect(warnings[1]).toBeUndefined()
    expect(warnings[2]).toContain('no progress across 3 runs')
    expect(warnings[2]).toContain('the same 1 finding(s) persist')
  })

  test('fixing one finding resets the counter', () => {
    const first = trackProgress(undefined, fp, 1)
    const second = trackProgress(first.state, fp, 1)
    const afterFix = trackProgress(second.state, fingerprintFindings([A, B]), 2)

    expect(second.state.runs).toBe(2)
    expect(afterFix.state.runs).toBe(1)
    expect(afterFix.warning).toBeUndefined()
  })

  test('a clean run never warns, however often it repeats', () => {
    // Three green runs is a repository with nothing wrong with it, not a stuck loop. A
    // detector that cried "no progress" at a clean build would be ignored within a day.
    let state: ProgressState | undefined
    for (let i = 0; i < 5; i++) {
      const report = trackProgress(state, fingerprintFindings([]), 0)
      state = report.state
      expect(report.warning).toBeUndefined()
    }
  })

  test('keeps warning past the third run rather than falling silent', () => {
    const state: ProgressState = { fingerprint: fp, runs: NO_PROGRESS_RUNS }
    const report = trackProgress(state, fp, 1)

    expect(report.state.runs).toBe(4)
    expect(report.warning).toContain('no progress across 4 runs')
  })
})

describe('progress state round trip', () => {
  test('serialises and parses back', () => {
    const state: ProgressState = { fingerprint: 'abc', runs: 2 }

    expect(parseProgress(serialiseProgress(state))).toEqual(state)
  })

  test('a missing or corrupt note resets rather than throwing', () => {
    expect(parseProgress(undefined)).toBeUndefined()
    expect(parseProgress('not json')).toBeUndefined()
    expect(parseProgress('{"fingerprint":"abc"}')).toBeUndefined()
    expect(parseProgress('{"fingerprint":1,"runs":1}')).toBeUndefined()
    expect(parseProgress('null')).toBeUndefined()
  })
})
