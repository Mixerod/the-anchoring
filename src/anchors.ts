/**
 * Anchors — the bridge between the intent graph and the structural graph.
 *
 * An anchor is a stable reference to code. Two forms, deliberately no third:
 *
 *   file:src/verify.ts   verified against the filesystem
 *   sym:tempoCost        verified against the codegraph index
 *
 * Line numbers are not an anchor form and never will be. They rot within one commit,
 * and a reference that silently becomes wrong is worse than no reference at all.
 * That rule is the reason this file exists: every anchor must be machine-checkable,
 * so ADR-0013's promise is enforced rather than merely written down.
 */

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import type { AnchoringConfig } from './config.js'

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

export function parseAnchor(raw: string): Anchor | undefined {
  const [prefix, ...rest] = raw.split(':')
  const value = rest.join(':').trim()
  if (!value) return undefined
  if (prefix === 'file') return { form: 'file', value }
  if (prefix === 'sym' && SYMBOL_RE.test(value)) return { form: 'sym', value }
  return undefined
}

export function hasCodegraphIndex(config: AnchoringConfig): boolean {
  return existsSync(join(config.root, '.codegraph'))
}

/**
 * Asks codegraph whether a symbol exists. `undefined` means "could not tell" — which the
 * caller must report as unverifiable rather than quietly treating as either answer.
 *
 * Injected as an argument (rule 5, and INV-CORE-PURITY's reasoning applied one layer out)
 * so the resolver is testable without a live index.
 */
export type SymbolProbe = (root: string, name: string) => boolean | undefined

export const codegraphProbe: SymbolProbe = (root, name) => {
  // `shell: true` is required on Windows, where `codegraph` is a .cmd shim. The name is
  // validated against SYMBOL_RE before it ever reaches here, so nothing shell-significant
  // can appear on the command line.
  const run = spawnSync('codegraph', ['query', name, '--json', '--limit', '1', '-p', root], {
    encoding: 'utf8',
    shell: true,
    timeout: 20_000,
  })
  if (run.error || run.status !== 0) return undefined

  try {
    const parsed: unknown = JSON.parse(run.stdout)
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

export function createResolver(config: AnchoringConfig, probe: SymbolProbe = codegraphProbe): Resolver {
  const indexed = config.symbolIndex === 'codegraph' && hasCodegraphIndex(config)
  const cache = new Map<string, AnchorResult>()

  const resolve = (raw: string): AnchorResult => {
    const cached = cache.get(raw)
    if (cached) return cached

    const result = ((): AnchorResult => {
      const anchor = parseAnchor(raw)
      if (!anchor) {
        return { raw, status: 'malformed', detail: 'expected `file:<path>` or `sym:<name>`' }
      }
      if (anchor.form === 'file') {
        return existsSync(join(config.root, anchor.value))
          ? { raw, status: 'resolved' }
          : { raw, status: 'missing', detail: 'no such file' }
      }
      if (config.symbolIndex === 'none') {
        return {
          raw,
          status: 'unverifiable',
          detail: 'symbol index disabled in anchoring.config.json',
        }
      }
      if (!indexed) {
        return { raw, status: 'unverifiable', detail: 'no .codegraph index — run `codegraph init`' }
      }
      const found = probe(config.root, anchor.value)
      if (found === undefined) {
        return { raw, status: 'unverifiable', detail: 'codegraph query failed' }
      }
      return found
        ? { raw, status: 'resolved' }
        : { raw, status: 'missing', detail: 'symbol not found in the index' }
    })()

    cache.set(raw, result)
    return result
  }

  return { resolve, indexed }
}
