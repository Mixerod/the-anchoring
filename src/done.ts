/**
 * `kb done` — the recording gate.
 *
 * The failure this exists to prevent: an agent finishes a change, the change is correct,
 * and nothing anywhere records why it happened. Six weeks later the reasoning is gone and
 * the next agent re-derives it wrongly.
 *
 * Asking an agent to remember does not work — prose is followed about 70% of the time.
 * So this does not ask. It reads `git diff`, compares it against what the intent graph
 * claims, and names the gaps with the file to edit and the line to add.
 */

import { LINK_FIELDS } from './model.js'
import { type Entity, type Store } from './store.js'
import { loadStore } from './loader.js'
import { gitChangedFiles, type ChangedFiles } from './git.js'
import { parseAnchor } from './anchors.js'
import type { AnchoringConfig } from './config.js'

export type GapKind = 'unlinked-decision' | 'unclaimed-code' | 'status' | 'open-incident'

export interface Gap {
  readonly kind: GapKind
  readonly message: string
  readonly fix: string
}

export interface UnclaimedWorkReport {
  readonly files: readonly string[]
  readonly message: string
  readonly fix: string
}

export interface DoneReport {
  readonly work?: Entity
  readonly workId: string
  readonly changed: readonly string[]
  readonly gaps: readonly Gap[]
}

/**
 * Only source code is *required* to have a recorded reason.
 *
 * An allowlist, not a denylist, and deliberately so: with a denylist every new config file,
 * lockfile, or harness tweak reappears as a false "nobody explained this", and a check that
 * cries wolf on every turn is one that gets switched off. Config and docs may still be
 * anchored — `kb why` will answer for them — they are simply not chased.
 */
const isGoverned = (path: string, config: AnchoringConfig): boolean =>
  config.governedPaths.some((prefix) => path.startsWith(prefix))

function anchorPaths(entity: Entity): readonly string[] {
  const spec = LINK_FIELDS[entity.kind]
  return Object.entries(entity.links)
    .filter(([field]) => spec[field]?.kind === 'anchor')
    .flatMap(([, values]) => values)
    .flatMap((raw) => {
      const anchor = parseAnchor(raw)
      return anchor?.form === 'file' ? [anchor.value] : []
    })
}

const covers = (anchor: string, file: string): boolean =>
  anchor === file || file.startsWith(`${anchor}/`)

function decisionGaps(work: Entity, changed: readonly string[], store: Store): readonly Gap[] {
  const claimed = new Set(work.links['implements'] ?? [])

  return [...store.byId.values()]
    .filter((e) => e.kind === 'ADR' && !claimed.has(e.id))
    .flatMap((adr) => {
      const hit = changed.find((file) => anchorPaths(adr).some((a) => covers(a, file)))
      return hit === undefined
        ? []
        : [
            {
              kind: 'unlinked-decision' as const,
              message: `${hit} is governed by ${adr.id} (${adr.title}), which ${work.id} does not claim`,
              fix: `add \`implements: [${adr.id}]\` to ${work.path}, or explain why it does not apply`,
            },
          ]
    })
}

function coverageGaps(changed: readonly string[], store: Store, config: AnchoringConfig): readonly Gap[] {
  const anchors = [...store.byId.values()].flatMap(anchorPaths)
  const orphans = changed
    .filter((file) => isGoverned(file, config))
    .filter((file) => !anchors.some((a) => covers(a, file)))

  return orphans.length === 0
    ? []
    : [
        {
          kind: 'unclaimed-code',
          message: `no document explains: ${orphans.join(', ')}`,
          fix: 'anchor these to an ADR or FLOW, or write the one that is missing',
        },
      ]
}

function incidentGaps(changed: readonly string[], store: Store): readonly Gap[] {
  return [...store.byId.values()]
    .filter((e) => e.kind === 'INC' && e.status === 'open')
    .filter((inc) => changed.some((file) => anchorPaths(inc).some((a) => covers(a, file))))
    .map((inc) => ({
      kind: 'open-incident' as const,
      message: `${inc.id} is open and touches code this change edits`,
      fix: `if this change fixes it, set \`status: fixed\` and \`closed_by\` in ${inc.path}`,
    }))
}

/**
 * What the Stop hook says when source code changed and no work item is open.
 *
 * INC-0001: six files landed in `apps/` and every gate stayed quiet, because `kb done`
 * needs a work id and the hook supplies one only if `kb ctx` left a session note. Opening
 * no work item was therefore a complete bypass of the intent graph.
 *
 * The silence itself was right and is kept for docs, config, and the knowledge base — a
 * hook that scolds on every unrelated turn is switched off within a week, and then nothing
 * is enforced at all. It is only broken for the `governedPaths` allowlist, the same one
 * `coverageGaps` uses, so the two cannot drift apart.
 *
 * Returns `null` when there is nothing to say. Never an error, never a failed turn.
 */
export function unclaimedWork(
  config: AnchoringConfig,
  changedFiles: ChangedFiles = gitChangedFiles,
): { readonly files: readonly string[]; readonly message: string; readonly fix: string } | null {
  const files = changedFiles(config.root).filter((path) => isGoverned(path, config))
  if (files.length === 0) return null

  return {
    files,
    message: `no work item is open, but this change touches: ${files.join(', ')}`,
    fix: 'run `kb ctx W-<n>` to claim the work, or open a work item for it',
  }
}

export function done(
  config: AnchoringConfig,
  workId: string,
  changedFiles: ChangedFiles = gitChangedFiles,
): DoneReport {
  const store = loadStore(config)
  const work = store.byId.get(workId)
  const changed = changedFiles(config.root)

  if (!work || work.kind !== 'WORK') {
    return {
      workId,
      changed,
      gaps: [
        {
          kind: 'status',
          message: `no work item \`${workId}\``,
          fix: `create ${config.kinds.WORK.dir}/${workId}.md, or name the item you are working on`,
        },
      ],
    }
  }

  const statusGap: readonly Gap[] =
    work.status === 'done' || work.status === 'dropped'
      ? []
      : [
          {
            kind: 'status',
            message: `${work.id} is still \`${work.status}\``,
            fix: `set \`status: done\` in ${work.path} once the gate in rule 60 passes`,
          },
        ]

  return {
    work,
    workId,
    changed,
    gaps: [
      ...decisionGaps(work, changed, store),
      ...incidentGaps(changed, store),
      ...coverageGaps(changed, store, config),
      ...statusGap,
    ],
  }
}
