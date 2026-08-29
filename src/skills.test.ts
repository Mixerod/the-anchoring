import { describe, expect, it } from 'vitest'
import {
  BYTES_PER_TOKEN_ESTIMATE,
  parseAutotrigger,
  planSkills,
  type SkillDoc,
  type SkillsInput,
} from './skills.js'
import type { Entity } from './store.js'

function skill(path: string, name: string, description: string): SkillDoc {
  return { path, name, description }
}

function entity(id: string, anchors: readonly string[]): Entity {
  return {
    id,
    kind: 'WORK',
    title: `title of ${id}`,
    status: 'open',
    path: `.anchor/work/${id}.md`,
    links: { anchors: [...anchors] },
    fields: {},
  }
}

function input(over: Partial<SkillsInput> = {}): SkillsInput {
  return { present: true, skills: [], ...over }
}

describe('parseAutotrigger', () => {
  it('keeps comments and blanks out of the entry list', () => {
    const entries = parseAutotrigger('# a comment\n\n   \ndeploy\n')

    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ address: 'deploy', source: 'local', lineNumber: 4 })
  })

  it('reads the four line shapes the protocol defines', () => {
    const entries = parseAutotrigger(
      ['sec-checklist', 'team-flows/', '@hub:sylphai/glowmotion', '@gh:stripe/kit/payments'].join(
        '\n',
      ),
    )

    expect(entries.map((e) => [e.address, e.source, e.directory])).toEqual([
      ['sec-checklist', 'local', false],
      ['team-flows', 'local', true],
      ['hub:sylphai/glowmotion', 'cloud', false],
      ['gh:stripe/kit/payments', 'cloud', false],
    ])
  })

  it('reports a duplicate line rather than counting it twice', () => {
    const entries = parseAutotrigger('deploy\ndeploy\n')

    expect(entries.filter((e) => !e.duplicate)).toHaveLength(1)
    expect(entries.filter((e) => e.duplicate)).toHaveLength(1)
  })

  it('flags a glob, because this reader does not implement gitignore patterns', () => {
    const entries = parseAutotrigger('team-*/deploy\n!keep\n')

    expect(entries.every((e) => e.unsupported)).toBe(true)
  })
})

describe('planSkills — tiers', () => {
  it('reports nothing to do when the project has no .atskills/', () => {
    const report = planSkills(input({ present: false }), [])

    expect(report.present).toBe(false)
    expect(report.resident).toEqual([])
    expect(report.saved).toEqual([])
  })

  it('separates what fires on its own from what merely sits there', () => {
    const report = planSkills(
      input({
        skills: [
          skill('deploy', 'deploy', 'Ship a release.'),
          skill('my-tdd', 'my-tdd', 'Write the test first.'),
        ],
        autotrigger: 'deploy\n',
      }),
      [],
    )

    expect(report.resident.map((r) => r.path)).toEqual(['deploy'])
    expect(report.saved.map((s) => s.path)).toEqual(['my-tdd'])
  })

  it('expands a directory line to every skill beneath it', () => {
    const report = planSkills(
      input({
        skills: [
          skill('team-flows/deploy', 'deploy', 'Ship it.'),
          skill('team-flows/review', 'review', 'Review it.'),
          skill('solo', 'solo', 'Alone.'),
        ],
        autotrigger: 'team-flows/\n',
      }),
      [],
    )

    expect(report.resident.map((r) => r.path)).toEqual(['team-flows/deploy', 'team-flows/review'])
    expect(report.saved.map((s) => s.path)).toEqual(['solo'])
  })

  it('loads a skill once when two lines name it', () => {
    const report = planSkills(
      input({
        skills: [skill('team-flows/deploy', 'deploy', 'Ship it.')],
        autotrigger: 'team-flows/\nteam-flows/deploy\n',
      }),
      [],
    )

    expect(report.resident).toHaveLength(1)
  })

  it('counts a cloud line as resident cost that cannot be weighed offline', () => {
    const report = planSkills(input({ autotrigger: '@gh:stripe/kit/payments\n' }), [])

    expect(report.cloud.map((c) => c.address)).toEqual(['gh:stripe/kit/payments'])
    expect(report.resident).toEqual([])
  })

  it('reports a local line that matches no skill instead of silently dropping it', () => {
    const report = planSkills(input({ skills: [], autotrigger: 'ghost\n' }), [])

    expect(report.unresolved.map((u) => u.address)).toEqual(['ghost'])
  })
})

describe('planSkills — token estimate', () => {
  it('charges name and description, and nothing for a saved skill', () => {
    const report = planSkills(
      input({
        skills: [skill('deploy', 'deploy', 'Ship a release to production.'), skill('idle', 'idle', 'x')],
        autotrigger: 'deploy\n',
      }),
      [],
    )

    const bytes = 'deploy'.length + 'Ship a release to production.'.length
    expect(report.residentTokens).toBe(Math.ceil(bytes / BYTES_PER_TOKEN_ESTIMATE))
  })

  it('estimates zero when nothing is resident', () => {
    const report = planSkills(input({ skills: [skill('idle', 'idle', 'x')] }), [])

    expect(report.residentTokens).toBe(0)
  })
})

describe('planSkills — citations from the intent graph', () => {
  it('credits a file: anchor that names the skill directory', () => {
    const report = planSkills(
      input({ skills: [skill('deploy', 'deploy', 'Ship it.')], autotrigger: 'deploy\n' }),
      [entity('W-16', ['file:.atskills/deploy'])],
    )

    expect(report.resident[0]?.citedBy).toEqual(['W-16'])
    expect(report.uncited).toEqual([])
  })

  it('credits a directory anchor that covers the skill', () => {
    const report = planSkills(
      input({
        skills: [skill('team-flows/deploy', 'deploy', 'Ship it.')],
        autotrigger: 'team-flows/\n',
      }),
      [entity('INV-DEP-DIRECTION', ['file:.atskills/team-flows/'])],
    )

    expect(report.resident[0]?.citedBy).toEqual(['INV-DEP-DIRECTION'])
  })

  it('names a resident skill no document justifies — the advisory this command exists for', () => {
    const report = planSkills(
      input({ skills: [skill('deploy', 'deploy', 'Ship it.')], autotrigger: 'deploy\n' }),
      [entity('W-16', ['file:src/cli.ts'])],
    )

    expect(report.uncited).toEqual(['deploy'])
    expect(report.resident[0]?.citedBy).toEqual([])
  })

  it('says nothing about a saved skill: Tier 2 costs nothing and needs no justification', () => {
    const report = planSkills(input({ skills: [skill('idle', 'idle', 'x')] }), [])

    expect(report.uncited).toEqual([])
  })
})

describe('planSkills — suggestions', () => {
  it('suggests a line for a saved skill an anchor already points at', () => {
    const report = planSkills(
      input({ skills: [skill('deploy', 'deploy', 'Ship it.')] }),
      [entity('W-16', ['file:.atskills/deploy'])],
    )

    expect(report.suggestions).toEqual([
      { address: 'deploy', citedBy: ['W-16'], line: 'deploy', comment: '# cited by W-16' },
    ])
  })

  it('suggests nothing for a skill already resident', () => {
    const report = planSkills(
      input({ skills: [skill('deploy', 'deploy', 'Ship it.')], autotrigger: 'deploy\n' }),
      [entity('W-16', ['file:.atskills/deploy'])],
    )

    expect(report.suggestions).toEqual([])
  })

  it('suggests nothing for a skill nothing cites: an uncited skill has not earned residency', () => {
    const report = planSkills(input({ skills: [skill('deploy', 'deploy', 'Ship it.')] }), [])

    expect(report.suggestions).toEqual([])
  })
})
