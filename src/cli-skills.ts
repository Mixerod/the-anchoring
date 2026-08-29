/**
 * `kb skills` — CLI wiring.
 *
 * Extracted from `cli.ts` for the reason `cli-brief.ts` and `cli-verify.ts` were: a `switch`
 * arm is not where a command composes three modules. The weighing is `skills.ts` (pure), the
 * reading is `skills-source.ts`, the printing is `render-skills.ts`, and none of them knows
 * this file exists.
 *
 * This command writes nothing. `.atskills/` belongs to the host project and to the @skills
 * protocol; what this tool concludes leaves as a printed line for a human to paste.
 */

import { loadStore } from './loader.js'
import { planSkills } from './skills.js'
import { readSkillsInput } from './skills-source.js'
import { renderSkills } from './render-skills.js'
import type { Palette } from './render.js'
import type { AnchoringConfig } from './config.js'

/**
 * Exit code is always 0.
 *
 * A resident skill nothing anchors is a cost worth seeing, not a broken build. `kb skills`
 * runs beside `kb verify`, and rule 8 is explicit that an advisory gate reports and never
 * fails the turn — a gate that blocks on bookkeeping is switched off within a week, and then
 * nothing is enforced at all.
 */
export function skillsCommand(
  config: AnchoringConfig,
  out: (text: string) => void,
  palette: Palette,
): number {
  const input = readSkillsInput(config)
  const entities = [...loadStore(config).byId.values()]
  out(renderSkills(planSkills(input, entities), palette))
  return 0
}
