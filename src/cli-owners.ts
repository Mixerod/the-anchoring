/**
 * `kb owners` — CLI wiring.
 *
 * Extracted from `cli.ts` for the reason `cli-brief.ts`, `cli-verify.ts`, `cli-pack.ts`,
 * `cli-promote.ts`, and `cli-skills.ts` were: a `switch` arm is not where a command decides
 * a target path, branches on `--check`, formats a table, and writes a file. The projection
 * itself is `owners.ts` and is pure; this file is the wiring around it.
 *
 * The move was behaviour-preserving: the body below is the arm as it stood, unchanged.
 */

import { defaultFsProbe, defaultInitIo } from './init.js'
import { planOwners } from './owners.js'
import type { AnchoringConfig } from './config.js'

export function ownersCommand(
  config: AnchoringConfig,
  rest: readonly string[],
  out: (text: string) => void,
): number {
  const probe = defaultFsProbe(config.root)
  const io = defaultInitIo(config.root)
  const targetPath = probe('.github') ? '.github/CODEOWNERS' : 'CODEOWNERS'
  const existing = io.readFile(targetPath)
  const report = planOwners(config, probe, existing)

  if (rest.includes('--check')) {
    if (report.mappings.length === 0) {
      out('CODEOWNERS: ok (no owners declared)')
      return 0
    }
    if (existing === undefined) {
      out(`${report.targetFile}: missing`)
      return 1
    }
    if (existing !== report.renderedContent) {
      out(`${report.targetFile}: stale`)
      return 1
    }
    out(`${report.targetFile}: ok`)
    return 0
  }

  if (report.mappings.length === 0) {
    out('kb owners: no owners declared in any entity.')
    return 0
  }

  out('Path                           Owner       Via')
  out('------------------------------ ----------- --------')
  for (const m of report.mappings) {
    out(`${m.path.padEnd(30)} ${m.owner.padEnd(11)} ${m.via}`)
  }
  for (const note of report.notes) {
    out(note)
  }

  io.writeFile(report.targetFile, report.renderedContent)
  out(`\nkb owners: wrote ${report.targetFile}`)
  return 0
}
