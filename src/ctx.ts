/**
 * `kb ctx` — tier 2 of progressive disclosure.
 *
 * Agent Skills load ~80 tokens of metadata per skill and pull the body only when the task
 * turns out to need it. This is the same shape applied to work: given one work item, name
 * every document that bears on it — decisions, invariants, flows, prior incidents, and the
 * code it touches — without pasting a single body.
 *
 * The agent then reads the two or three that matter. That is the whole saving: the cold
 * start stops being "read these eight files" and becomes "here are the four that apply".
 */

import { LINK_FIELDS } from './model.js'
import { type Entity, type Store } from './store.js'
import { loadStore } from './loader.js'
import { hasCodegraphIndex } from './resolver.js'
import type { AnchoringConfig } from './config.js'

export interface CtxSection {
  readonly heading: string
  readonly entries: readonly CtxEntry[]
  /** Shown when the section is empty — silence would read as "nothing applies". */
  readonly emptyNote: string
}

export interface CtxEntry {
  readonly id: string
  readonly title: string
  readonly path: string
  readonly via: string
}

export interface CtxReport {
  readonly subject?: Entity
  readonly query: string
  readonly sections: readonly CtxSection[]
  readonly anchors: readonly string[]
  readonly workDir?: string
  readonly indexed?: boolean
}

function refs(entity: Entity, field: string, store: Store): readonly Entity[] {
  return (entity.links[field] ?? []).flatMap((id) => {
    const target = store.byId.get(id)
    return target ? [target] : []
  })
}

function anchorsOf(entity: Entity): readonly string[] {
  const spec = LINK_FIELDS[entity.kind]
  return Object.entries(entity.links)
    .filter(([field]) => spec[field]?.kind === 'anchor')
    .flatMap(([, values]) => values)
}

/** Any entity anchored to code this work also touches: prior art on the same lines. */
function neighbours(subject: Entity, store: Store): readonly CtxEntry[] {
  const own = new Set(anchorsOf(subject))
  if (own.size === 0) return []

  return [...store.byId.values()]
    .filter((other) => other.id !== subject.id)
    .flatMap((other) => {
      const shared = anchorsOf(other).filter((a) => own.has(a))
      return shared.length === 0 || shared[0] === undefined
        ? []
        : [{ id: other.id, title: other.title, path: other.path, via: shared[0] }]
    })
}

export function ctx(config: AnchoringConfig, query: string): CtxReport {
  const store = loadStore(config)
  const indexed = config.symbolIndex === 'codegraph' && hasCodegraphIndex(config)
  const subject = store.byId.get(query)
  if (!subject) {
    return {
      query,
      sections: [],
      anchors: [],
      workDir: config.kinds.WORK.dir,
      indexed,
    }
  }

  const entry = (via: string) => (e: Entity): CtxEntry => ({
    id: e.id,
    title: e.title,
    path: e.path,
    via,
  })

  const decisions = [...refs(subject, 'implements', store)]
  // A decision's invariants bind this work too, even though the work never names them.
  const invariants = decisions.flatMap((d) => refs(d, 'constrains', store))
  const incidents = refs(subject, 'closes', store)
  const blockers = refs(subject, 'blocked_by', store)

  const seen = new Set<string>()
  const dedupe = (entries: readonly CtxEntry[]): readonly CtxEntry[] =>
    entries.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))

  return {
    query,
    subject,
    anchors: anchorsOf(subject),
    workDir: config.kinds.WORK.dir,
    indexed,
    sections: [
      {
        heading: 'Decides this work',
        entries: dedupe(decisions.map(entry('implements'))),
        emptyNote: 'no decision or flow claimed - say what this work is for, or link one',
      },
      {
        heading: 'Must still hold',
        entries: dedupe(invariants.map(entry('via the decision above'))),
        emptyNote: 'no invariant reachable from this work',
      },
      {
        heading: 'Blocked by',
        entries: dedupe(blockers.map(entry('blocked_by'))),
        emptyNote: 'nothing',
      },
      {
        heading: 'Closes',
        entries: dedupe(incidents.map(entry('closes'))),
        emptyNote: 'no incident',
      },
      {
        heading: 'Has happened here before',
        entries: dedupe(neighbours(subject, store)),
        emptyNote: 'no prior record on the code this work touches',
      },
    ],
  }
}
