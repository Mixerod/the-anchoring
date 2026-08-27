import { describe, expect, test } from 'vitest'
import { parseFrontmatter, toList } from './frontmatter.js'

describe('parseFrontmatter', () => {
  test('reads a mapping from a leading fenced block', () => {
    const result = parseFrontmatter('---\nid: ADR-0001\nstatus: accepted\n---\n\n# Title\n')

    expect(result).toEqual({ ok: true, data: { id: 'ADR-0001', status: 'accepted' } })
  })

  test('reads a block written with CRLF line endings', () => {
    const result = parseFrontmatter('---\r\nid: ADR-0001\r\n---\r\nbody\r\n')

    expect(result.ok && result.data['id']).toBe('ADR-0001')
  })

  test('rejects a document with no frontmatter block', () => {
    const result = parseFrontmatter('# Just a heading\n')

    expect(result).toEqual({ ok: false, reason: 'no YAML frontmatter block' })
  })

  test('rejects a block that is not at the very top', () => {
    const result = parseFrontmatter('# Heading\n\n---\nid: ADR-0001\n---\n')

    expect(result.ok).toBe(false)
  })

  test('reports invalid YAML rather than throwing', () => {
    const result = parseFrontmatter('---\nid: [unclosed\n---\n')

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/invalid YAML/)
  })

  test('rejects a block that parses to a list instead of a mapping', () => {
    const result = parseFrontmatter('---\n- one\n- two\n---\n')

    expect(result).toEqual({ ok: false, reason: 'frontmatter must be a YAML mapping' })
  })
})

describe('toList', () => {
  test('treats a missing field as empty', () => {
    expect(toList(undefined)).toEqual([])
    expect(toList(null)).toEqual([])
  })

  test('accepts a bare scalar as a one-element list', () => {
    expect(toList('ADR-0003')).toEqual(['ADR-0003'])
  })

  test('passes a list through as strings', () => {
    expect(toList(['a', 'b'])).toEqual(['a', 'b'])
  })
})
