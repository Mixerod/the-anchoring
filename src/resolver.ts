/**
 * Anchor resolver implementation for filesystem and codegraph.
 *
 * Checks `file:` anchors using `node:fs` and `sym:` anchors using `codegraph`.
 * Belongs in the infra layer.
 */

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import {
  parseAnchor,
  parseProbeOutput,
  type AnchorResult,
  type Resolver,
  type SymbolProbe,
} from './anchors.js'
import type { AnchoringConfig } from './config.js'

export function hasCodegraphIndex(config: AnchoringConfig): boolean {
  return existsSync(join(config.root, '.codegraph'))
}

/* c8 ignore start -- spawn-and-delegate; the decision it delegates to is parseProbeOutput */
export const codegraphProbe: SymbolProbe = (root, name) => {
  const run = spawnSync('codegraph', ['query', name, '--json', '--limit', '1', '-p', root], {
    encoding: 'utf8',
    shell: true,
    timeout: 20_000,
  })
  if (run.error || run.status !== 0) return undefined
  return parseProbeOutput(run.stdout)
}
/* c8 ignore stop */

export function createResolver(
  config: AnchoringConfig,
  probe: SymbolProbe = codegraphProbe,
): Resolver {
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
