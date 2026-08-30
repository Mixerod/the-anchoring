/**
 * End to end: frontmatter on disk, through `loadDoctrine`, into `kb ask` and `kb ctx`.
 *
 * `doctrine.test.ts` covers the scoring in isolation. This file covers the thing that
 * actually broke — the corpus was on disk the whole time and no command could find it — so
 * every test here starts from real files.
 */
import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ask } from './ask.js'
import { ctx } from './ctx.js'
import { loadDoctrine } from './loader.js'
import { defaultConfig } from './config.js'
import { renderAsk, renderCtx, PLAIN } from './render.js'

function fixture(docs: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'kb-doctrine-'))
  for (const [path, body] of Object.entries(docs)) {
    const full = join(root, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return root
}

const IDEMPOTENCY = `---
title: Idempotency and delivery semantics
tags: [messaging, retries, payments]
when:
  - a retry could apply the same effect twice
  - a consumer may receive the same message more than once
---

# Idempotency and delivery semantics

Prose an agent pays to read only after deciding to.
`

/** Exactly the shape of every doctrine file that existed before triggers did. */
const LEGACY = `# Verification and Honesty

Report the command's actual output.
`

const CORPUS = {
  'anchoring.config.json': '{}',
  '.anchor/doctrine/idempotency.md': IDEMPOTENCY,
  '.anchor/doctrine/verification.md': LEGACY,
  '.anchor/work/W-1.md':
    '---\nid: W-1\ntitle: "Add the payment webhook consumer"\nstatus: doing\ntags: [messaging]\ntouches: []\n---\n\n## Goal\n',
}

describe('loadDoctrine reads Tier 1 and nothing more', () => {
  test('parses title, tags, and triggers from frontmatter', () => {
    const docs = loadDoctrine(defaultConfig(fixture(CORPUS)))
    const idem = docs.find((d) => d.name === 'idempotency.md')

    expect(idem?.title).toBe('Idempotency and delivery semantics')
    expect(idem?.tags).toEqual(['messaging', 'retries', 'payments'])
    expect(idem?.when).toEqual([
      'a retry could apply the same effect twice',
      'a consumer may receive the same message more than once',
    ])
  })

  test('a file with no frontmatter still loads, titled by its first heading', () => {
    const docs = loadDoctrine(defaultConfig(fixture(CORPUS)))
    const legacy = docs.find((d) => d.name === 'verification.md')

    expect(legacy?.title).toBe('Verification and Honesty')
    expect(legacy?.tags).toBeUndefined()
    expect(legacy?.when).toBeUndefined()
  })

  test('frontmatter title wins over the heading when both are present', () => {
    const root = fixture({
      ...CORPUS,
      '.anchor/doctrine/x.md': '---\ntitle: The declared one\n---\n\n# The incidental one\n',
    })
    const doc = loadDoctrine(defaultConfig(root)).find((d) => d.name === 'x.md')

    expect(doc?.title).toBe('The declared one')
  })
})

describe('kb ask finds a technique by the situation, not by its name', () => {
  /**
   * The exact query that returned nothing before this existed. If this test ever passes
   * vacuously — no doctrine in the fixture — it stops being the test it was written to be.
   */
  test('a symptom the reader cannot name still reaches the file', () => {
    const report = ask(defaultConfig(fixture(CORPUS)), 'the webhook must not double charge on retry')

    expect(report.doctrine.matched.map((m) => m.doc.name)).toEqual(['idempotency.md'])
    expect(report.doctrine.matched[0]?.trigger).toBe('a retry could apply the same effect twice')
  })

  test('the rendered output prints the trigger, not just the filename', () => {
    const report = ask(defaultConfig(fixture(CORPUS)), 'retry could apply the same effect twice')
    const text = renderAsk(report, PLAIN)

    expect(text).toContain('when: a retry could apply the same effect twice')
  })

  test('an unrelated query matches nothing and says so, rather than ranking noise', () => {
    const report = ask(defaultConfig(fixture(CORPUS)), 'kubernetes ingress controller')

    expect(report.doctrine.matched).toEqual([])
    expect(report.doctrine.unmatched.map((d) => d.name)).toEqual([
      'idempotency.md',
      'verification.md',
    ])
    expect(renderAsk(report, PLAIN)).toContain('nothing matched')
  })
})

describe('kb ctx surfaces technique for the work item at hand', () => {
  test('a work item whose tags meet a trigger gets the technique named', () => {
    const report = ctx(defaultConfig(fixture(CORPUS)), 'W-1')

    expect(report.doctrine.map((m) => m.doc.name)).toEqual(['idempotency.md'])
    expect(renderCtx(report, PLAIN)).toContain('Technique that may apply')
  })

  /**
   * Silence must be earned. A section that vanishes when nothing matched reads as "no
   * technique applies", which is a claim the corpus cannot support.
   */
  test('when nothing matches, the section still speaks and blames the corpus', () => {
    const root = fixture({
      ...CORPUS,
      '.anchor/work/W-2.md':
        '---\nid: W-2\ntitle: "Rename an internal helper"\nstatus: doing\ntouches: []\n---\n\n## Goal\n',
    })
    const text = renderCtx(ctx(defaultConfig(root), 'W-2'), PLAIN)

    expect(text).toContain('Technique that may apply')
    expect(text).toContain('no doctrine trigger matched')
  })
})
