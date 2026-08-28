/**
 * Anchors — the bridge between the intent graph and the structural graph.
 *
 * An anchor is a stable reference to code. Two forms, deliberately no third:
 *
 *   file:src/verify.ts        verified against the filesystem
 *   sym:createResolver        verified against the codegraph index
 *
 * Pure domain module: defines anchor types, parser, and checker.
 * Filesystem and codegraph probes live in infra/resolver.ts.
 */

import type { Entity } from './store.js'

/** Symbol names are passed to a child process; refuse anything that is not one. */
const SYMBOL_RE = /^[A-Za-z_$][A-Za-z0-9_$.]*$/

export type Anchor =
  | { readonly form: 'file'; readonly value: string }
  | { readonly form: 'sym'; readonly value: string }

export type AnchorStatus = 'resolved' | 'missing' | 'unverifiable' | 'malformed'

export interface AnchorResult {
  readonly raw: string
  readonly status: AnchorStatus
  readonly detail?: string
}

export type AnchorResolution = AnchorResult

export function parseAnchor(raw: string): Anchor | undefined {
  const [prefix, ...rest] = raw.split(':')
  const value = rest.join(':').trim()
  if (!value) return undefined
  if (prefix === 'file') return { form: 'file', value }
  if (prefix === 'sym' && SYMBOL_RE.test(value)) return { form: 'sym', value }
  return undefined
}

/**
 * Whether a `file:` anchor's value covers a path from a diff.
 *
 * The trailing slash is the whole subtlety, and getting it wrong was a live defect: the
 * obvious `file.startsWith(`${anchor}/`)` builds `src//` for the directory anchor
 * `file:src/`, which matches nothing. `INV-SECRETS-NO-LITERALS` holds for `file:src/`, and
 * `kb done` was nonetheless reporting "no document explains: src/upstream.ts" — a gate
 * crying wolf about a file that was anchored all along. A check that reports a false
 * positive on ordinary work is a check people learn to scroll past, which costs more than
 * the check was ever worth.
 *
 * Lives here rather than in either caller because `done.ts` and `since.ts` both need it and
 * a rule kept in two places is a rule maintained in neither.
 */
export function anchorCovers(anchor: string, file: string): boolean {
  const base = anchor.endsWith('/') ? anchor.slice(0, -1) : anchor
  return base === file || file.startsWith(`${base}/`)
}

export type SymbolProbe = (root: string, name: string) => boolean | undefined

/**
 * The pure half of the codegraph probe: everything except the spawn.
 *
 * `codegraph query --json` has three shapes in the wild — a bare array, `{results:[…]}`,
 * and `{symbols:[…]}` — and any of them may be empty. `undefined` means *could not tell*,
 * which the resolver reports as `unverifiable` rather than `missing`; a parse failure must
 * never be read as "the symbol is gone".
 *
 * Extracted so the decision is testable without a child process, which is the same
 * treatment every other I/O boundary in this codebase already gets.
 */
export function parseProbeOutput(stdout: string): boolean | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout)
    const rows = Array.isArray(parsed)
      ? parsed
      : ((parsed as { results?: unknown }).results ?? (parsed as { symbols?: unknown }).symbols)
    return Array.isArray(rows) && rows.length > 0
  } catch {
    return undefined
  }
}

export interface Resolver {
  readonly resolve: (raw: string) => AnchorResult
  readonly indexed: boolean
}

export interface AnchorFinding {
  readonly severity: 'error' | 'warn'
  readonly where: string
  readonly message: string
  readonly hint?: string
}

export function checkAnchors(
  entity: Entity,
  resolver: Resolver,
): { readonly findings: readonly AnchorFinding[]; readonly count: number } {
  const findings: AnchorFinding[] = []
  let count = 0

  for (const [field, values] of Object.entries(entity.links)) {
    for (const raw of values) {
      if (!raw.startsWith('file:') && !raw.startsWith('sym:')) continue
      count++
      const result = resolver.resolve(raw)
      if (result.status === 'malformed') {
        findings.push({
          severity: 'error',
          where: `${entity.id} · ${field}`,
          message: `anchor \`${raw}\` is malformed: ${result.detail ?? 'syntax error'}`,
        })
      } else if (result.status === 'missing') {
        findings.push({
          severity: 'error',
          where: `${entity.id} · ${field}`,
          message: `anchor \`${raw}\` is missing (${result.detail ?? 'not found'})`,
          hint: 'the code this anchor pointed at no longer exists — update or retire this claim',
        })
      } else if (result.status === 'unverifiable') {
        findings.push({
          severity: 'warn',
          where: `${entity.id} · ${field}`,
          message: `anchor \`${raw}\` cannot be verified (${result.detail ?? 'unverifiable'})`,
        })
      }
    }
  }

  return { findings, count }
}
