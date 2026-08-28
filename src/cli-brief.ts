/**
 * `kb brief` — CLI wiring only.
 *
 * Routing and I/O selection live here; the bundle is planned by `brief.ts` and rendered by
 * `render-brief.ts`, both pure. Rule 20: controllers only move data.
 *
 * The flag surface is deliberately just `--json` and `--check`. Reporting corpus size is
 * Part B's `--stats`; `briefSizes` in `render-brief.ts` is the function it should call, so
 * that the two never measure the bundle two different ways.
 */

import { planBrief } from './brief.js'
import { readBriefInput } from './brief-source.js'
import { renderBrief, renderBriefJson, compareRenders } from './render-brief.js'
import { corpusStats, renderStats } from './render-stats.js'
import { recallWork } from './session.js'
import type { AnchoringConfig } from './config.js'

export const BRIEF_USAGE = 'usage: kb brief [--json] [--check] [--stats]'

const KNOWN_FLAGS = ['--json', '--check', '--stats']

/** Flags `run` consumes before dispatch, which every subcommand must therefore tolerate. */
const GLOBAL_FLAGS = ['--no-colour', '--no-color', '--colour', '--color']

/**
 * `--check` renders twice from two *independent* loads of the corpus.
 *
 * Rendering one in-memory object twice would prove nothing: the instability this guards
 * against enters at load time, where `readdir` order is not guaranteed and differs between
 * machines. Two full loads is the cheapest honest test.
 */
function checkStability(config: AnchoringConfig, out: (text: string) => void): number {
  const first = renderBrief(planBrief(readBriefInput(config)))
  const second = renderBrief(planBrief(readBriefInput(config)))
  const result = compareRenders(first, second)

  if (result.stable) {
    // Says what it checked, not merely that it passed: a gate whose success message could
    // also be printed by a gate that ran nothing is a gate nobody can audit.
    out(`kb brief: byte-stable across 2 independent loads (${first.length} chars rendered)`)
    out('  -> stability is the cache precondition; the harness confirms the hit itself,')
    out('     by reading usage.cache_read_input_tokens and treating a persistent 0 as a defect')
    return 0
  }

  out(
    `kb brief: UNSTABLE at byte ${result.offset ?? 0}` +
      (result.tier !== undefined ? ` (tier ${result.tier})` : ''),
  )
  out('  -> two loads of an unchanged corpus rendered different bytes; the cache prefix moves')
  return 1
}

export function briefCommand(
  config: AnchoringConfig,
  rest: readonly string[],
  out: (text: string) => void,
  err: (text: string) => void,
): number {
  const unknown = rest.filter(
    (a) => a.startsWith('-') && !KNOWN_FLAGS.includes(a) && !GLOBAL_FLAGS.includes(a),
  )
  if (unknown.length > 0) {
    err(`kb brief: unknown option ${unknown[0]}\n${BRIEF_USAGE}`)
    return 2
  }

  if (rest.includes('--check')) return checkStability(config, out)

  const input = readBriefInput(config, recallWork(config))
  const brief = planBrief(input)

  if (rest.includes('--stats')) {
    out(renderStats(corpusStats(brief, input)))
    return 0
  }

  out(rest.includes('--json') ? renderBriefJson(brief) : renderBrief(brief))
  return 0
}
