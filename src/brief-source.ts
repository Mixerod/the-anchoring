/**
 * The I/O half of `kb brief`.
 *
 * Exists so `brief.ts` can stay pure — the same split `loader.ts` gives `store.ts` and
 * `pack-source.ts` gives `pack.ts`. Reads every document body from disk on every invocation;
 * there is no index and no cache, by design.
 */

import { join } from 'node:path'
import { loadStore, loadDoctrine, readText } from './loader.js'
import type { AnchoringConfig } from './config.js'
import type { BriefDoctrine, BriefEntity, BriefFile, BriefInput } from './brief.js'

const AGENTS_FILE = 'AGENTS.md'

/**
 * Reading goes through `loader.ts` rather than through a `node:fs` import of its own.
 * A corpus missing AGENTS.md or a doctrine file is a smaller brief, not a failure.
 */
const readOrUndefined = (absolute: string): string | undefined => readText(absolute)

/**
 * Read every source the brief renders from.
 *
 * Order is not established here. `readdir` order is not guaranteed and differs between
 * machines, so sorting is done by `planBrief` over ids and names — never over what the
 * filesystem happened to return.
 */
export function readBriefInput(config: AnchoringConfig, session?: string): BriefInput {
  const agentsBody = readOrUndefined(join(config.root, AGENTS_FILE))
  const agents: BriefFile | undefined =
    agentsBody === undefined
      ? undefined
      : { name: AGENTS_FILE, path: AGENTS_FILE, body: agentsBody }

  const doctrine: BriefDoctrine[] = []
  for (const summary of loadDoctrine(config)) {
    const body = readOrUndefined(join(config.root, summary.path))
    if (body !== undefined) {
      doctrine.push({ name: summary.name, path: summary.path, body, summary })
    }
  }

  const entities: BriefEntity[] = []
  for (const entity of loadStore(config).byId.values()) {
    const body = readOrUndefined(join(config.root, entity.path))
    if (body !== undefined) entities.push({ entity, body })
  }

  return {
    ...(agents !== undefined ? { agents } : {}),
    doctrine,
    entities,
    ...(session !== undefined ? { session } : {}),
  }
}
