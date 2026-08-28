/**
 * What a check reports, and the two constants every dated check shares.
 *
 * Split out of `verify.ts` so `verify-hazard.ts` and `verify-upstream.ts` can be checkers
 * in their own right without importing the module that calls them. A checker that has to
 * import its own caller is a cycle waiting to be discovered by `depcruise`.
 */

export type Severity = 'error' | 'warn'

export interface Finding {
  readonly severity: Severity
  readonly where: string
  readonly message: string
  readonly hint?: string
  /**
   * Reported, never gating: excluded from the exit code even under `--strict`.
   *
   * For checks about cost and hygiene rather than correctness — a verbose document is not a
   * broken one. Rule 8: an advisory gate reports and never fails the turn, because a build
   * that goes red over bookkeeping is a build people learn to bypass, taking the checks that
   * matter with it. `severity` stays `warn` so it still *prints*; silence would be worse
   * than either.
   */
  readonly advisory?: boolean
}

export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
export const DAY_MS = 86_400_000

/** Whole days between an ISO day and `now`, which is always passed in, never read. */
export function daysSince(isoDay: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(`${isoDay}T00:00:00Z`)) / DAY_MS)
}
