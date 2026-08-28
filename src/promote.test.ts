/**
 * Unit and integration tests for Layer 4 Part C: Promotion.
 */

import { describe, expect, test } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  planPromote,
  extractExistingHazards,
  nextHazardId,
} from './promote.js'
import type { Pack } from './pack.js'
import type { Entity } from './store.js'
import { run } from './cli.js'

function makeTemp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

const sampleIncident: Entity = {
  id: 'INC-0001',
  kind: 'INC',
  title: 'The CLI checked nothing and exited 0 when installed as a package',
  status: 'fixed',
  path: '.anchor/incident/INC-0001.md',
  links: {
    touches: ['file:src/cli.ts'],
    violates: [],
    found_in: [],
    closed_by: [],
  },
  fields: {
    tags: JSON.stringify(['cli', 'bugfix']),
  },
}

const sampleIncidentBody = `---
id: INC-0001
title: The CLI checked nothing and exited 0 when installed as a package
status: fixed
touches:
  - file:src/cli.ts
tags:
  - cli
  - bugfix
---

# INC-0001: The CLI checked nothing and exited 0 when installed as a package

## What happened

The first adopter installed this package and ran kb verify --strict. It printed nothing and returned exit code 0.

## Root cause

Direct invocation check compared process.argv[1] literally with import.meta.url.

## Prevention

Compare realpaths via isDirectlyInvoked.
`

const samplePack: Pack = {
  manifest: {
    name: 'discipline',
    version: '1.0.0',
    description: 'Discipline pack',
  },
  files: [
    {
      kind: 'invariant',
      basename: 'INV-SECRETS.md',
      body: '---\nid: INV-SECRETS\n---\n',
    },
  ],
  origin: '/path/to/pack',
}

describe('planPromote pure planner', () => {
  test('strips local anchors (holds_for forced to empty), sets resolution: not-applicable with reason', () => {
    const plan = planPromote(sampleIncident, sampleIncidentBody, samplePack, {
      toPack: 'discipline',
      source: 'https://github.com/mixerod/the-anchoring/commit/170a9f8',
      now: new Date('2026-08-28T00:00:00Z'),
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    expect(plan.hazard.id).toBe('HAZ-0001')
    expect(plan.hazard.relativePath).toBe('hazard/HAZ-0001.md')
    expect(plan.hazard.body).toContain('holds_for: []')
    expect(plan.hazard.body).toContain('resolves_to: []')
    expect(plan.hazard.body).toContain('resolution: not-applicable')
    expect(plan.hazard.body).toContain('reason: not yet triaged in this repository')
    expect(plan.hazard.body).toContain('source: https://github.com/mixerod/the-anchoring/commit/170a9f8')
    expect(plan.hazard.body).toContain('observed: 2026-08-28')
    expect(plan.hazard.body).toContain('recorded: 2026-08-28')
    expect(plan.hazard.body).toContain('promoted_from: INC-0001')
    expect(plan.hazard.body).toContain('# HAZ-0001: The CLI checked nothing and exited 0 when installed as a package')
    expect(plan.hazard.body).toContain('## What happened')
    expect(plan.hazard.body).toContain('## Root cause')
    expect(plan.hazard.body).toContain('## Prevention')
  })

  test('promoted document contains no absolute paths, no drive letters, and no source code from touches', () => {
    const rawLocalIncident = `---
id: INC-0001
title: Local failure
status: fixed
touches:
  - file:src/cli.ts
---

# INC-0001: Local failure

A bug occurred in relative module src/cli.ts during package execution.
`
    const plan = planPromote(sampleIncident, rawLocalIncident, samplePack, {
      toPack: 'discipline',
      source: 'https://github.com/mixerod/the-anchoring/issues/1',
      now: new Date('2026-08-28T00:00:00Z'),
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    const body = plan.hazard.body
    // No Windows drive letters (e.g. C:\, D:\, c:/, d:/)
    expect(body).not.toMatch(/(?<!https?):[/\\]/)
    expect(body).not.toMatch(/\b[a-zA-Z]:[/\\]/)
    // No Unix absolute paths like /Users/... or /home/...
    expect(body).not.toMatch(/\/(?:Users|home|var|tmp|etc|usr|opt)\b/i)
    // No code from touches: holds_for is empty
    expect(body).toContain('holds_for: []')
    expect(body).not.toContain('file:src/cli.ts')
  })

  test('requires source URL and fails if no source is given and incident has no upstream URL', () => {
    const plan = planPromote(sampleIncident, sampleIncidentBody, samplePack, {
      toPack: 'discipline',
      now: new Date('2026-08-28T00:00:00Z'),
    })

    expect(plan.ok).toBe(false)
    if (!plan.ok) {
      expect(plan.reason).toContain('carries no upstream evidence to derive source from; supply --source <url>')
    }
  })

  test('fails if invalid non-http(s) source URL is supplied', () => {
    const plan = planPromote(sampleIncident, sampleIncidentBody, samplePack, {
      toPack: 'discipline',
      source: 'someone told me on slack',
      now: new Date('2026-08-28T00:00:00Z'),
    })

    expect(plan.ok).toBe(false)
    if (!plan.ok) {
      expect(plan.reason).toContain('must be an http(s) URL')
    }
  })

  test('derives source from incident upstream field if it is a valid URL', () => {
    const incidentWithUpstream: Entity = {
      ...sampleIncident,
      fields: {
        upstream: 'https://github.com/upstream/repo/issues/42',
      },
    }
    const plan = planPromote(incidentWithUpstream, sampleIncidentBody, samplePack, {
      toPack: 'discipline',
      now: new Date('2026-08-28T00:00:00Z'),
    })

    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.hazard.body).toContain('source: https://github.com/upstream/repo/issues/42')
    }
  })

  test('rejects promoting non-incident entity kind', () => {
    const adrEntity: Entity = {
      id: 'ADR-0001',
      kind: 'ADR',
      title: 'Decide something',
      status: 'accepted',
      path: 'docs/adr/0001.md',
      links: {},
      fields: {},
    }
    const plan = planPromote(adrEntity, '', samplePack, {
      toPack: 'discipline',
      source: 'https://example.org',
      now: new Date('2026-08-28T00:00:00Z'),
    })
    expect(plan.ok).toBe(false)
    if (!plan.ok) {
      expect(plan.reason).toContain('ADR-0001 is a ADR, not an incident')
    }
  })
})

describe('Stable ID allocation on repeated promotion', () => {
  test('re-promoting the same incident returns the existing hazard ID and is marked isExisting', () => {
    const packWithExisting: Pack = {
      ...samplePack,
      files: [
        {
          kind: 'hazard',
          basename: 'HAZ-0001.md',
          body: '---\nid: HAZ-0001\ntitle: Prev\npromoted_from: INC-0001\n---\n',
        },
      ],
    }

    const plan = planPromote(sampleIncident, sampleIncidentBody, packWithExisting, {
      toPack: 'discipline',
      source: 'https://github.com/mixerod/the-anchoring/commit/170a9f8',
      now: new Date('2026-08-28T00:00:00Z'),
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    expect(plan.hazard.id).toBe('HAZ-0001')
    expect(plan.hazard.isExisting).toBe(true)
    expect(plan.notes[0]).toContain('INC-0001 already promoted to discipline as HAZ-0001')
  })

  test('promoting a second incident allocates next free ID HAZ-0002', () => {
    const packWithExisting: Pack = {
      ...samplePack,
      files: [
        {
          kind: 'hazard',
          basename: 'HAZ-0001.md',
          body: '---\nid: HAZ-0001\ntitle: Prev\npromoted_from: INC-0001\n---\n',
        },
      ],
    }

    const secondIncident: Entity = {
      id: 'INC-0002',
      kind: 'INC',
      title: 'Second incident',
      status: 'fixed',
      path: '.anchor/incident/INC-0002.md',
      links: { touches: [] },
      fields: {},
    }

    const plan = planPromote(secondIncident, '', packWithExisting, {
      toPack: 'discipline',
      source: 'https://github.com/mixerod/the-anchoring/commit/8c3aa3f',
      now: new Date('2026-08-28T00:00:00Z'),
    })

    expect(plan.ok).toBe(true)
    if (!plan.ok) return

    expect(plan.hazard.id).toBe('HAZ-0002')
    expect(plan.hazard.isExisting).toBe(false)
  })

  test('extractExistingHazards parses hazard IDs and promoted_from links', () => {
    const files = [
      {
        kind: 'hazard' as const,
        basename: 'HAZ-0001.md',
        body: '---\nid: HAZ-0001\ntitle: Haz 1\npromoted_from: INC-0001\n---\n',
      },
      {
        kind: 'hazard' as const,
        basename: 'HAZ-0002.md',
        body: '---\nid: HAZ-0002\ntitle: Haz 2\n---\n<!-- promoted-from: INC-0002 -->\n',
      },
      {
        kind: 'invariant' as const,
        basename: 'INV-TEST.md',
        body: '---\nid: INV-TEST\n---\n',
      },
    ]

    const extracted = extractExistingHazards(files)
    expect(extracted.length).toBe(2)
    expect(extracted[0]?.id).toBe('HAZ-0001')
    expect(extracted[0]?.promotedFrom).toBe('INC-0001')
    expect(extracted[1]?.id).toBe('HAZ-0002')
    expect(extracted[1]?.promotedFrom).toBe('INC-0002')
  })

  test('nextHazardId skips taken IDs', () => {
    expect(nextHazardId([])).toBe('HAZ-0001')
    expect(nextHazardId(['HAZ-0001', 'HAZ-0002'])).toBe('HAZ-0003')
    expect(nextHazardId(['HAZ-0001', 'HAZ-0003'])).toBe('HAZ-0002')
  })
})

describe('CLI kb promote integration', () => {
  test('kb promote INC-0001 --to-pack discipline --dry-run prints document and writes nothing', () => {
    const root = makeTemp('kb-promote-dryrun-')
    run(['init', '--no-colour'], () => {}, () => {}, root)

    // Create INC-0001 in repo
    mkdirSync(join(root, '.anchor', 'incident'), { recursive: true })
    writeFileSync(join(root, '.anchor', 'incident', 'INC-0001.md'), sampleIncidentBody)

    const out: string[] = []
    const err: string[] = []
    const code = run(
      ['promote', 'INC-0001', '--to-pack', 'discipline', '--source', 'https://example.org/inc1', '--dry-run'],
      (t) => out.push(t),
      (t) => err.push(t),
      root,
    )

    expect(code).toBe(0)
    const combined = out.join('\n')
    expect(combined).toContain('id: HAZ-0001')
    expect(combined).toContain('resolution: not-applicable')
    expect(combined).toContain('reason: not yet triaged in this repository')
    expect(combined).toContain('holds_for: []')
    expect(combined).toContain('source: https://example.org/inc1')
  })

  test('kb promote writes hazard into pack and subsequent kb pack add seeds it cleanly', () => {
    const userPacksDir = makeTemp('custom-user-packs-')
    const packDir = join(userPacksDir, 'mypack')
    mkdirSync(join(packDir, 'invariant'), { recursive: true })
    writeFileSync(
      join(packDir, 'pack.json'),
      JSON.stringify({ name: 'mypack', version: '1.0.0', description: 'Custom pack' }),
    )

    // Setup source repo
    const sourceRepo = makeTemp('kb-source-repo-')
    run(['init', '--no-colour'], () => {}, () => {}, sourceRepo)
    mkdirSync(join(sourceRepo, '.anchor', 'incident'), { recursive: true })
    writeFileSync(join(sourceRepo, '.anchor', 'incident', 'INC-0001.md'), sampleIncidentBody)

    // Set ANCHORING_PACKS so findPack finds mypack
    const origEnv = process.env['ANCHORING_PACKS']
    process.env['ANCHORING_PACKS'] = userPacksDir

    try {
      const out: string[] = []
      const code = run(
        ['promote', 'INC-0001', '--to-pack', 'mypack', '--source', 'https://example.org/issue/1'],
        (t) => out.push(t),
        () => {},
        sourceRepo,
      )
      expect(code).toBe(0)
      expect(out.join('\n')).toContain('kb promote: wrote')
      expect(existsSync(join(packDir, 'hazard', 'HAZ-0001.md'))).toBe(true)

      const hazardContent = readFileSync(join(packDir, 'hazard', 'HAZ-0001.md'), 'utf8')
      expect(hazardContent).toContain('id: HAZ-0001')
      expect(hazardContent).toContain('resolution: not-applicable')

      // Now create a scratch adopter repo and seed mypack
      const adopterRepo = makeTemp('kb-adopter-repo-')
      run(['init', '--no-colour'], () => {}, () => {}, adopterRepo)

      const addOut: string[] = []
      const addCode = run(['pack', 'add', 'mypack'], (t) => addOut.push(t), () => {}, adopterRepo)
      expect(addCode).toBe(0)
      expect(addOut.join('\n')).toContain('wrote .anchor/hazard/HAZ-0001.md')
      expect(addOut.join('\n')).toContain('1 hazard seeded; these arrive untriaged')

      // Verify strict in scratch adopter is clean
      const verifyOut: string[] = []
      const verifyCode = run(['verify', '--strict'], (t) => verifyOut.push(t), () => {}, adopterRepo)
      expect(verifyCode).toBe(0)
      expect(verifyOut.join('\n')).toContain('kb verify: clean')
    } finally {
      if (origEnv !== undefined) process.env['ANCHORING_PACKS'] = origEnv
      else delete process.env['ANCHORING_PACKS']
    }
  })
})
