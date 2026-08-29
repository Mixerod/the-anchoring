import { describe, expect, it } from 'vitest'
import { renderSkills } from './render-skills.js'
import { planSkills, type SkillsInput } from './skills.js'
import { PLAIN } from './render.js'
import type { Entity } from './store.js'

function render(input: SkillsInput, entities: readonly Entity[] = []): string {
  return renderSkills(planSkills(input, entities), PLAIN)
}

function work(id: string, anchors: readonly string[]): Entity {
  return {
    id,
    kind: 'WORK',
    title: id,
    status: 'doing',
    path: `.anchor/work/${id}.md`,
    links: { touches: [...anchors] },
    fields: {},
  }
}

const deploy = { path: 'deploy', name: 'deploy', description: 'Ship a release.' }

describe('renderSkills', () => {
  it('invites rather than scolds when the project has no .atskills/', () => {
    const text = render({ present: false, skills: [] })

    expect(text).toContain('no .atskills/ in this repository')
    expect(text).toContain('reference')
    expect(text).not.toContain('[warn]')
  })

  it('labels the token figure an estimate and shows its divisor', () => {
    const text = render({ present: true, skills: [deploy], autotrigger: 'deploy\n' })

    expect(text).toContain('estimated at 4 bytes/token')
  })

  it('says so plainly when nothing fires on its own', () => {
    const text = render({ present: true, skills: [deploy] })

    expect(text).toContain('nothing fires on its own')
  })

  /**
   * The case this command exists for. A gate that stays quiet here is worse than no gate,
   * because it also removes the suspicion that would have caught the problem.
   */
  it('speaks up about a resident skill no document anchors', () => {
    const text = render({ present: true, skills: [deploy], autotrigger: 'deploy\n' })

    expect(text).toContain('[warn]')
    expect(text).toContain('nothing in the graph anchors it')
    expect(text).toContain('never fails the turn')
  })

  it('goes quiet once a document anchors it', () => {
    const text = render({ present: true, skills: [deploy], autotrigger: 'deploy\n' }, [
      work('W-1', ['file:.atskills/deploy']),
    ])

    expect(text).toContain('[ok]')
    expect(text).not.toContain('[warn]')
    expect(text).not.toContain('no document anchors')
  })

  it('names what it did not count, so the filter can be audited', () => {
    const text = render({
      present: true,
      skills: [],
      autotrigger: '@gh:stripe/kit/payments\nteam-*/x\nghost\n',
    })

    expect(text).toContain('Not counted')
    expect(text).toContain("a provider's copy")
    expect(text).toContain('gitignore pattern')
    expect(text).toContain('no skill at .atskills/ghost')
  })

  it('offers a line to paste and says it will not write the file itself', () => {
    const text = render({ present: true, skills: [deploy] }, [work('W-1', ['file:.atskills/deploy'])])

    expect(text).toContain('kb never writes that file')
    expect(text).toContain('# cited by W-1')
  })
})
