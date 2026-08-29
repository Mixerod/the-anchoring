/**
 * Asking ESLint what it would actually apply to a file.
 *
 * Exists so `guards.ts` can stay pure while `kb guards --verify-live` still answers the only
 * question that matters after composition: is the generated rule in force, or did a later
 * config object replace it without saying so.
 *
 * `--print-config` is the supported way to ask, and it runs the host's own ESLint and their
 * own config resolution - which is the point. A reimplementation here would answer about a
 * config nobody runs.
 */

import { spawnSync } from 'node:child_process'

export type PrintConfig = (
  root: string,
  file: string,
) => Readonly<Record<string, unknown>> | undefined

/**
 * The pure half: turn `eslint --print-config` output into a rules table.
 *
 * `undefined` means *could not tell* — no ESLint, a config error, unparseable output — and
 * the caller must report that rather than silently treating it as "no rules are missing".
 * A verifier that reads its own failure as a pass is worse than no verifier.
 */
export function parsePrintConfig(stdout: string): Readonly<Record<string, unknown>> | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (parsed === null || typeof parsed !== 'object') return undefined
    const rules = (parsed as { rules?: unknown }).rules
    if (rules === null || typeof rules !== 'object') return undefined
    return rules as Readonly<Record<string, unknown>>
  } catch {
    return undefined
  }
}

/* c8 ignore start -- spawn-and-delegate; the parsing it delegates to is tested above */
export const printConfig: PrintConfig = (root, file) => {
  const result = spawnSync('npx', ['eslint', '--print-config', file], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    shell: process.platform === 'win32',
  })
  if (result.error || result.status !== 0) return undefined
  return parsePrintConfig(result.stdout)
}
/* c8 ignore stop */
