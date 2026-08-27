/**
 * `kb why` — the inverse index.
 *
 * codegraph answers "what does this code call". This answers the question codegraph
 * structurally cannot: what this code is *for* — which flow it serves, which decision
 * governs it, which invariant it must uphold, and how it has broken before.
 *
 * Everything here is a reverse walk of the same links `kb verify` checks, which is why
 * the two commands can never disagree.
 */

import { EDGE_PHRASE, LINK_FIELDS } from './model.js'
import { loadStore, type Entity } from './store.js'
import { parseAnchor } from './anchors.js'

export interface Mention {
  readonly entity: Entity
  readonly field: string
  readonly phrase: string
  readonly matched: string
}

export interface WhyReport {
  readonly query: string
  readonly subject?: Entity
  readonly mentions: readonly Mention[]
  readonly outgoing: readonly { readonly field: string; readonly target: Entity }[]
  readonly incoming: readonly { readonly field: string; readonly source: Entity }[]
}

/** A file anchor matches its own path and any path beneath it, so a directory works too. */
function anchorMatches(anchorValue: string, query: string): boolean {
  if (anchorValue === query) return true
  return query.endsWith('/') ? anchorValue.startsWith(query) : anchorValue.startsWith(`${query}/`)
}

function normalisePath(query: string): string {
  return query.split('\\').join('/').replace(/^\.\//, '')
}

function findMentions(query: string, entities: readonly Entity[]): readonly Mention[] {
  const path = normalisePath(query)
  const mentions: Mention[] = []

  for (const entity of entities) {
    const spec = LINK_FIELDS[entity.kind]
    for (const [field, values] of Object.entries(entity.links)) {
      if (spec[field]?.kind !== 'anchor') continue
      for (const raw of values) {
        const anchor = parseAnchor(raw)
        if (!anchor) continue
        const hit =
          anchor.form === 'file' ? anchorMatches(anchor.value, path) : anchor.value === query
        if (hit) {
          mentions.push({
            entity,
            field,
            phrase: EDGE_PHRASE[field] ?? field,
            matched: raw,
          })
        }
      }
    }
  }
  return mentions
}

export function why(root: string, query: string): WhyReport {
  const store = loadStore(root)
  const entities = [...store.byId.values()]
  const subject = store.byId.get(query)

  if (!subject) {
    return { query, mentions: findMentions(query, entities), outgoing: [], incoming: [] }
  }

  const spec = LINK_FIELDS[subject.kind]
  const outgoing = Object.entries(subject.links)
    .filter(([field]) => spec[field]?.kind === 'ref')
    .flatMap(([field, values]) =>
      values.flatMap((value) => {
        const target = store.byId.get(value)
        return target ? [{ field, target }] : []
      }),
    )

  const incoming = entities.flatMap((source) =>
    Object.entries(source.links)
      .filter(([field]) => LINK_FIELDS[source.kind][field]?.kind === 'ref')
      .filter(([, values]) => values.includes(subject.id))
      .map(([field]) => ({ field, source })),
  )

  return { query, subject, mentions: [], outgoing, incoming }
}
