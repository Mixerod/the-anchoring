import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSkillsInput } from './skills-source.js'
import { defaultConfig } from './config.js'
import type { AnchoringConfig } from './config.js'

let scratch: string

function configFor(root: string): AnchoringConfig {
  return { ...defaultConfig(root), root }
}

function writeSkill(relPath: string, frontmatter: string): void {
  const dir = join(scratch, '.atskills', ...relPath.split('/'))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\nBody.\n`, 'utf8')
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'kb-skills-src-'))
})

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('readSkillsInput', () => {
  it('reports absence rather than failing: not adopting the protocol is a legitimate state', () => {
    const input = readSkillsInput(configFor(scratch))

    expect(input.present).toBe(false)
    expect(input.skills).toEqual([])
    expect(input.autotrigger).toBeUndefined()
  })

  it('reads name and description out of the frontmatter', () => {
    writeSkill('deploy', 'name: deploy\ndescription: Ship a release.')

    const input = readSkillsInput(configFor(scratch))

    expect(input.present).toBe(true)
    expect(input.skills).toEqual([{ path: 'deploy', name: 'deploy', description: 'Ship a release.' }])
  })

  it('finds a skill nested under a directory, at its true relative path', () => {
    writeSkill('team-flows/deploy', 'name: deploy\ndescription: Ship it.')

    expect(readSkillsInput(configFor(scratch)).skills.map((s) => s.path)).toEqual([
      'team-flows/deploy',
    ])
  })

  it('stops at the leaf: a SKILL.md bundled inside a skill is not a second skill', () => {
    writeSkill('deploy', 'name: deploy\ndescription: Ship it.')
    const nested = join(scratch, '.atskills', 'deploy', 'references')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'SKILL.md'), '---\nname: nope\n---\n', 'utf8')

    expect(readSkillsInput(configFor(scratch)).skills.map((s) => s.path)).toEqual(['deploy'])
  })

  it('keeps a skill whose frontmatter will not parse — it still occupies a slot', () => {
    const dir = join(scratch, '.atskills', 'broken')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'SKILL.md'), 'no frontmatter here\n', 'utf8')

    expect(readSkillsInput(configFor(scratch)).skills).toEqual([
      { path: 'broken', name: 'broken', description: '' },
    ])
  })

  it('never reports a dotfile as a skill', () => {
    writeSkill('deploy', 'name: deploy\ndescription: Ship it.')
    writeFileSync(join(scratch, '.atskills', '.autotrigger'), 'deploy\n', 'utf8')

    const input = readSkillsInput(configFor(scratch))

    expect(input.skills.map((s) => s.path)).toEqual(['deploy'])
    expect(input.autotrigger).toBe('deploy\n')
  })

  it('reports a present .atskills/ with no .autotrigger as zero resident cost, not as missing', () => {
    writeSkill('deploy', 'name: deploy\ndescription: Ship it.')

    const input = readSkillsInput(configFor(scratch))

    expect(input.present).toBe(true)
    expect(input.autotrigger).toBeUndefined()
  })
})
