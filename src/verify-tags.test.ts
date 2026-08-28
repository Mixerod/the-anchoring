import { describe, expect, test } from 'vitest'
import { checkTags, checkTagVocabulary, entityTags } from './verify-tags.js'
import { buildStore, type Entity } from './store.js'
import { exitCodeFor } from './cli-verify.js'

function entity(id: string, tags?: string): Entity {
  return {
    id,
    kind: 'WORK',
    title: `${id} title`,
    status: 'doing',
    path: `.anchor/work/${id}.md`,
    links: {},
    fields: tags === undefined ? {} : { tags },
  }
}

const list = (...tags: string[]): string => JSON.stringify(tags)

describe('entityTags', () => {
  test('reads a well-formed list', () => {
    expect(entityTags(entity('W-1', list('alpha', 'beta')))).toEqual(['alpha', 'beta'])
  })

  test('returns empty for an absent field and undefined for a malformed one', () => {
    // Absent and malformed must stay distinguishable: the shape error is reported once, and
    // the vocabulary pass must not report it a second time.
    expect(entityTags(entity('W-1'))).toEqual([])
    expect(entityTags(entity('W-1', 'not-a-list'))).toBeUndefined()
    expect(entityTags(entity('W-1', '[1,2]'))).toBeUndefined()
  })
})

describe('shape — an error in both modes', () => {
  test('rejects a non-slug tag', () => {
    const [finding] = checkTags(entity('W-1', list('Not A Slug')))

    expect(finding?.severity).toBe('error')
    expect(finding?.message).toContain('is not a lowercase slug')
  })

  test('rejects a tags field that is not a list', () => {
    expect(checkTags(entity('W-1', 'payment'))[0]?.severity).toBe('error')
  })

  test('accepts lowercase slugs with digits and hyphens', () => {
    expect(checkTags(entity('W-1', list('layer-4', 'pay2')))).toEqual([])
  })

  test('a non-slug tag is an error with a vocabulary declared too', () => {
    expect(checkTags(entity('W-1', list('Bad Tag')))[0]?.severity).toBe('error')
  })
})

describe('no vocabulary declared — the singleton default', () => {
  /** The test where it must speak. */
  test('warns about a tag used exactly once', () => {
    const store = buildStore([entity('W-1', list('shared', 'lonely')), entity('W-2', list('shared'))])

    const findings = checkTagVocabulary(store)

    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('warn')
    expect(findings[0]?.message).toContain('`lonely` is used exactly once')
    expect(findings[0]?.where).toBe('W-1 · tags')
  })

  test('the singleton warning never fails --strict', () => {
    // It is a hint about vocabulary quality. A build that fails on one is a build people
    // bypass, and the checks that matter get bypassed with it.
    const store = buildStore([entity('W-1', list('lonely'))])

    expect(exitCodeFor(checkTagVocabulary(store), true)).toBe(0)
    expect(checkTagVocabulary(store)[0]?.advisory).toBe(true)
  })

  test('says nothing when every tag is shared', () => {
    const store = buildStore([entity('W-1', list('shared')), entity('W-2', list('shared'))])

    expect(checkTagVocabulary(store)).toEqual([])
  })

  test('ignores a malformed tags field, which checkTags already reported', () => {
    const store = buildStore([entity('W-1', 'not-a-list')])

    expect(checkTagVocabulary(store)).toEqual([])
  })
})

describe('vocabulary declared', () => {
  const vocabulary = ['payment', 'security']

  test('an out-of-vocabulary tag is an error', () => {
    const store = buildStore([entity('W-1', list('payment', 'paymnet'))])

    const findings = checkTagVocabulary(store, { vocabulary })

    expect(findings).toHaveLength(1)
    expect(findings[0]?.severity).toBe('error')
    expect(findings[0]?.message).toContain('`paymnet` is not in the declared tag vocabulary')
  })

  test('and it fails --strict, which is what makes declaring one worth anything', () => {
    const store = buildStore([entity('W-1', list('paymnet'))])

    expect(exitCodeFor(checkTagVocabulary(store, { vocabulary }), true)).toBe(1)
    // An error fails even without --strict.
    expect(exitCodeFor(checkTagVocabulary(store, { vocabulary }), false)).toBe(1)
  })

  test('a singleton in the vocabulary is fine — the default no longer applies', () => {
    const store = buildStore([entity('W-1', list('payment'))])

    expect(checkTagVocabulary(store, { vocabulary })).toEqual([])
  })
})

describe('determinism', () => {
  test('findings come out in tag order regardless of entity order', () => {
    const a = buildStore([entity('W-1', list('zebra')), entity('W-2', list('alpha'))])
    const b = buildStore([entity('W-2', list('alpha')), entity('W-1', list('zebra'))])

    const messages = (s: typeof a) => checkTagVocabulary(s).map((f) => f.message)

    expect(messages(a)).toEqual(messages(b))
    expect(messages(a)[0]).toContain('alpha')
  })
})
