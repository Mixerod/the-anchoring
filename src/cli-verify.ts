/**
 * `kb verify` — CLI wiring, including the two Layer 5 variants.
 *
 * Extracted from `cli.ts` because `verify` now has three shapes (full, `--since`,
 * `--fingerprint`) and a `switch` arm is not the place to grow a third. The checking itself
 * is still `verify.ts`; the filtering is `since.ts`; the counter is `fingerprint.ts`. All
 * three are pure and none of them know this file exists.
 */

import { verify } from './verify.js'
import { loadStore } from './loader.js'
import { filterSince } from './since.js'
import {
  fingerprintFindings,
  parseProgress,
  serialiseProgress,
  trackProgress,
} from './fingerprint.js'
import { readSessionNote, writeSessionNote } from './session.js'
import { gitChangedSince, type ChangedSince } from './git.js'
import { renderVerify, renderSince, type Palette } from './render.js'
import type { AnchoringConfig } from './config.js'
import type { Finding } from './finding.js'

export const PROGRESS_NOTE = 'progress'

function flagValue(rest: readonly string[], flag: string): string | undefined {
  const index = rest.indexOf(flag)
  if (index !== -1) return rest[index + 1]
  const inline = rest.find((a) => a.startsWith(`${flag}=`))
  return inline?.slice(flag.length + 1)
}

/** Exit code: errors always fail; warnings fail only under `--strict`. */
export function exitCodeFor(findings: readonly Finding[], strict: boolean): number {
  const errors = findings.filter((f) => f.severity === 'error').length
  const warnings = findings.length - errors
  return errors > 0 || (strict && warnings > 0) ? 1 : 0
}

function runSince(
  config: AnchoringConfig,
  ref: string,
  strict: boolean,
  palette: Palette,
  out: (text: string) => void,
  err: (text: string) => void,
  changedSince: ChangedSince,
): number {
  const changed = changedSince(config.root, ref)
  if (changed === undefined) {
    // Never silently degrade to "nothing changed": that would exit 0 having checked nothing.
    err(`kb verify: cannot read changes since \`${ref}\` — is it a valid git ref?`)
    return 2
  }

  const report = verify(config)
  const since = filterSince(loadStore(config), report.findings, changed, ref)
  out(renderSince(since, palette))
  return exitCodeFor(since.findings, strict)
}

/**
 * The no-progress notice, for `kb done --check`.
 *
 * Returns the line to print, or `undefined`. It never returns an exit code, because it never
 * gets one: this warns and does not fail the turn under any flag. See `fingerprint.ts`.
 */
export function progressNotice(
  config: AnchoringConfig,
  findings: readonly Finding[],
): string | undefined {
  const fingerprint = fingerprintFindings(findings)
  const previous = parseProgress(readSessionNote(config, PROGRESS_NOTE))
  const report = trackProgress(previous, fingerprint, findings.length)
  writeSessionNote(config, PROGRESS_NOTE, serialiseProgress(report.state))
  return report.warning
}

export function verifyCommand(
  config: AnchoringConfig,
  rest: readonly string[],
  out: (text: string) => void,
  err: (text: string) => void,
  palette: Palette,
  changedSince: ChangedSince = gitChangedSince,
): number {
  const strict = rest.includes('--strict')

  const since = flagValue(rest, '--since')
  if (rest.some((a) => a === '--since' || a.startsWith('--since='))) {
    if (since === undefined || since.startsWith('-') || since.trim() === '') {
      err('usage: kb verify --since <git-ref> [--strict]')
      return 2
    }
    return runSince(config, since, strict, palette, out, err, changedSince)
  }

  const report = verify(config)

  if (rest.includes('--fingerprint')) {
    // The finding set only. Not counts, not order, not timing — see fingerprintFindings.
    out(fingerprintFindings(report.findings))
    return exitCodeFor(report.findings, strict)
  }

  out(renderVerify(report, palette))
  return exitCodeFor(report.findings, strict)
}
