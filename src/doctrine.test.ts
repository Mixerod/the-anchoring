import { describe, expect, test } from 'vitest'
import { rankDoctrine, scoreDoctrine, type DoctrineSummary } from './doctrine.js'
import { extractQueryTokens } from './tokens.js'

const doc = (over: Partial<DoctrineSummary>): DoctrineSummary => ({
  path: '.anchor/doctrine/x.md',
  name: 'x.md',
  ...over,
})

const q = (s: string) => extractQueryTokens(s)

describe('scoreDoctrine weighting', () => {
  test('a trigger outranks the same words in tags, title, or filename', () => {
    const query = q('retry applies the same effect twice')

    const byTrigger = doc({ name: 'a.md', when: ['a retry could apply the same effect twice'] })
    const byTags = doc({ name: 'b.md', tags: ['retry', 'apply', 'same', 'effect', 'twice'] })
    const byTitle = doc({ name: 'c.md', title: 'Retry apply same effect twice' })
    const byName = doc({ name: 'retry-apply-same-effect-twice.md' })

    const s = (d: DoctrineSummary) => scoreDoctrine(query, d).score

    expect(s(byTrigger)).toBeGreaterThan(s(byTags))
    expect(s(byTags)).toBeGreaterThan(s(byTitle))
    expect(s(byTitle)).toBeGreaterThan(s(byName))
  })

  test('reports which trigger fired, so the match carries its own evidence', () => {
    const match = scoreDoctrine(q('duplicate message delivered twice'), doc({
      when: [
        'a cache is colder than the traffic it serves',
        'a consumer may receive the same message more than once',
      ],
    }))

    expect(match.trigger).toBe('a consumer may receive the same message more than once')
  })

  test('triggers score best-of, so listing more of them is never a penalty', () => {
    const query = q('leader election')
    const one = doc({ name: 'a.md', when: ['a cluster must agree on one leader'] })
    const many = doc({
      name: 'b.md',
      when: [
        'a cluster must agree on one leader',
        'two nodes both believe they are primary',
        'a write must not be applied twice',
        'a queue is growing faster than it drains',
      ],
    })

    expect(scoreDoctrine(query, many).score).toBe(scoreDoctrine(query, one).score)
  })

  test('a concise trigger beats a diluted one on the same hit', () => {
    const query = q('thundering herd')
    const concise = doc({ name: 'a.md', when: ['a thundering herd hits a cold cache'] })
    const diluted = doc({
      name: 'b.md',
      when: [
        'a thundering herd hits a cold cache after a deploy when many clients reconnect ' +
          'simultaneously across several regions and every one of them misses',
      ],
    })

    expect(scoreDoctrine(query, concise).score).toBeGreaterThan(scoreDoctrine(query, diluted).score)
  })

  test('an empty query scores nothing rather than everything', () => {
    expect(scoreDoctrine([], doc({ when: ['anything at all'] })).score).toBe(0)
  })
})

describe('rankDoctrine never hides', () => {
  const corpus = [
    doc({ name: 'idempotency.md', when: ['a retry could apply the same effect twice'] }),
    doc({ name: 'solid.md', title: 'SOLID principles' }),
    doc({ name: 'gates.md', title: 'Gates and automation' }),
  ]

  test('unmatched files are returned, not dropped', () => {
    const r = rankDoctrine(q('retry twice'), corpus)

    expect(r.matched.map((m) => m.doc.name)).toEqual(['idempotency.md'])
    expect(r.unmatched.map((d) => d.name)).toEqual(['gates.md', 'solid.md'])
  })

  test('the limit caps what is shown but never what is accounted for', () => {
    const r = rankDoctrine(q('retry twice'), corpus, 0)

    expect(r.matched).toEqual([])
    expect(r.unmatched.length).toBe(2)
  })

  /**
   * The case the mechanism exists for. A file with no frontmatter is the entire corpus as
   * it stood before triggers existed, and it must still list.
   */
  test('a file with no frontmatter still lists, and simply never outranks one with a trigger', () => {
    const r = rankDoctrine(q('solid principles'), corpus)

    expect(r.matched.map((m) => m.doc.name)).toEqual(['solid.md'])
    expect(r.matched[0]?.trigger).toBeUndefined()
  })

  test('ties break on name, so the same query always prints the same order', () => {
    const tied = [
      doc({ name: 'b.md', when: ['a queue is growing faster than it drains'] }),
      doc({ name: 'a.md', when: ['a queue is growing faster than it drains'] }),
    ]

    expect(rankDoctrine(q('queue drains'), tied).matched.map((m) => m.doc.name)).toEqual([
      'a.md',
      'b.md',
    ])
  })
})
