/**
 * Verifying that a generated rule is actually in force.
 *
 * Split from `guards.ts` for the reason rule 8 gives - two reasons to change. That file
 * *writes* configuration; this one asks whether the configuration survived being composed
 * with the host's own. They move for different reasons and one must not drag the other.
 *
 * The distinction this module exists for: `kb guards --check` proves the file on disk matches
 * the generator. It cannot prove the host's ESLint config did not discard it afterwards, and
 * ESLint flat config discards by default - a later object naming a rule replaces the earlier
 * one entirely, with no error and no output. See .anchor/incident/INC-0004.md.
 *
 * Pure module. Asking ESLint is `eslint-probe.ts`.
 */

import { GENERATED_RULES } from './guards.js'
import type { Architecture } from './config.js'

export { GENERATED_RULES }

export interface LiveExpectation {
  readonly rule: string
  /** A string that must appear in the applied rule's options for it to still mean anything. */
  readonly needle: string
  readonly why: string
}

/**
 * What each generated rule must still *contain* to be doing its job.
 *
 * Checking that the rule name is present with a non-off severity is not enough, and the
 * first version of this command proved it: a host block declaring
 * `no-restricted-imports` for lodash replaced the generated one, the name was still there
 * at severity error, the command reported "in force" - and `node:https` was importable from
 * the pure layer with no complaint. A verifier that cannot fail on the exact case it was
 * built for is decoration.
 *
 * So the expectations are content, not presence: the modules actually named, the selectors
 * actually written.
 */
export function liveExpectations(arch: Architecture, file: string): readonly LiveExpectation[] {
  const out: LiveExpectation[] = []

  if (!arch.ioExemptions.includes(file)) {
    for (const mod of arch.impureImports) {
      out.push({
        rule: 'no-restricted-imports',
        needle: mod,
        why: `${mod} is declared impure and must be banned outside the I/O adapters`,
      })
    }
  }

  for (const entry of arch.restrictedSyntax) {
    out.push({
      rule: 'no-restricted-syntax',
      needle: entry.selector,
      why: 'a project selector declared in anchoring.config.json',
    })
  }

  const pure = arch.layers.find((l) => l.pure)
  if (pure?.paths.includes(file)) {
    out.push({
      rule: 'no-restricted-syntax',
      needle: 'NewExpression[callee.name=',
      why: 'the pure layer must not construct a Date',
    })
    out.push({ rule: 'no-restricted-globals', needle: 'fetch', why: 'the pure layer must not fetch' })
    out.push({
      rule: 'no-restricted-properties',
      needle: 'random',
      why: 'the pure layer must not call Math.random',
    })
  }

  return out
}

export interface LiveRuleReport {
  readonly file: string
  readonly satisfied: readonly LiveExpectation[]
  /** Declared by the generated config and not actually applied to this file. */
  readonly missing: readonly LiveExpectation[]
}

/**
 * Which generated guarantees survive composition for one file.
 *
 * `kb guards --check` proves the file on disk matches the generator; it cannot prove the
 * host's ESLint config did not discard it afterwards. Flat config replaces a rule rather
 * than merging it, so one block in the wrong place silences a guarantee with no error and
 * no output. See INC-0004.
 */
/**
 * Whether any string anywhere inside an applied rule's options contains `needle`.
 *
 * Walks the structure rather than matching against `JSON.stringify`, because the selectors
 * this looks for contain double quotes and JSON escapes them - so the naive version reported
 * a live rule as missing, which is the same class of wrongness in the other direction.
 */
function containsNeedle(value: unknown, needle: string): boolean {
  if (typeof value === 'string') return value.includes(needle)
  if (Array.isArray(value)) return value.some((v) => containsNeedle(v, needle))
  if (value !== null && typeof value === 'object') {
    return Object.values(value).some((v) => containsNeedle(v, needle))
  }
  return false
}

export function checkLiveRules(
  file: string,
  expectations: readonly LiveExpectation[],
  applied: Readonly<Record<string, unknown>>,
): LiveRuleReport {
  const satisfied: LiveExpectation[] = []
  const missing: LiveExpectation[] = []

  for (const expectation of expectations) {
    const setting = applied[expectation.rule]
    const severity = Array.isArray(setting) ? setting[0] : setting
    const off = setting === undefined || severity === 'off' || severity === 0
    const carries = !off && containsNeedle(setting, expectation.needle)
    ;(carries ? satisfied : missing).push(expectation)
  }

  return { file, satisfied, missing }
}
