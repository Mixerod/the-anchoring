#!/usr/bin/env node
/**
 * kb — the intent graph over this repository.
 *
 *   kb init                bootstrap the intent graph into this repository
 *   kb verify [--strict]   check every claim the docs make about the code
 *   kb why <target>        what a file, symbol, or entity is for
 *   kb guards [--check]    generate architecture checkers from the dependency matrix
 *
 * This file only routes. Checking lives in verify.ts, the reverse walk in why.ts,
 * and every byte of output in render.ts. Rationale: docs/THE_ANCHORING.md.
 */

import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { findRepoRoot } from './root.js'
import { loadConfig } from './config.js'
import { defaultFsProbe, defaultInitIo, findGitRoot, planInit, applyInit, type InitPlan } from './init.js'
import { planGuards, checkGuards } from './guards.js'
import { updateAgentsMd } from './agents.js'
import { verify } from './verify.js'
import { why } from './why.js'
import { ctx } from './ctx.js'
import { done, unclaimedWork } from './done.js'
import { COLOUR, PLAIN, USAGE, renderCtx, renderDone, renderUnclaimed, renderVerify, renderWhy } from './render.js'
import { gitChangedFiles, type ChangedFiles } from './git.js'
import { recallWork, rememberWork } from './session.js'

export function run(
  argv: readonly string[],
  out: (text: string) => void,
  err: (text: string) => void,
  root?: string,
  changedFiles: ChangedFiles = gitChangedFiles,
): number {
  const [command, ...rest] = argv
  const palette = rest.includes('--no-colour') ? PLAIN : COLOUR
  const positional = rest.find((a) => !a.startsWith('-'))

  if (command === 'init') {
    let kbRootArg: string | undefined
    const kbRootIndex = rest.indexOf('--kb-root')
    if (kbRootIndex !== -1 && rest[kbRootIndex + 1]) {
      kbRootArg = rest[kbRootIndex + 1]
    } else {
      const kbRootFlag = rest.find((a) => a.startsWith('--kb-root='))
      if (kbRootFlag) {
        kbRootArg = kbRootFlag.slice('--kb-root='.length)
      }
    }
    const dryRun = rest.includes('--dry-run')
    const force = rest.includes('--force')
    const guards = rest.includes('--guards')

    const initRoot = root ?? findGitRoot(process.cwd()) ?? process.cwd()
    const probe = defaultFsProbe(initRoot)
    const io = defaultInitIo(initRoot)

    let plan: InitPlan
    try {
      plan = planInit(initRoot, { kbRoot: kbRootArg, dryRun, force, guards }, probe)
    } catch (e) {
      err(`kb init: ${(e as Error).message}`)
      return 1
    }

    if (dryRun) {
      out(`kb init: dry run for ${initRoot}\n`)
      for (const dir of plan.dirs) {
        out(`  dir   ${dir}`)
      }
      for (const file of plan.files) {
        out(`  file  ${file.path}`)
      }
      if (plan.gitignoreLine) {
        out(`  git   .gitignore gains ${plan.gitignoreLine}`)
      }
      for (const note of plan.notes) {
        out(`\n${note}`)
      }
      return 0
    }

    const written = applyInit(plan, io)
    out(`kb init: initialized intent graph in ${initRoot}\n`)
    for (const path of written) {
      out(`  created ${path}`)
    }
    for (const note of plan.notes) {
      out(`\n${note}`)
    }
    return 0
  }

  const resolvedRoot = root ?? findRepoRoot(process.cwd())
  if (!resolvedRoot) {
    err('kb: not inside a repository. Run `kb init` at the root of your project first.')
    return 2
  }

  const configResult = loadConfig(resolvedRoot)
  if (!configResult.ok) {
    for (const problem of configResult.problems) {
      err(`config error: ${problem}`)
    }
    return 2
  }
  const config = configResult.config

  switch (command) {
    case 'ctx': {
      if (!positional) {
        err('usage: kb ctx <W-id>')
        return 2
      }
      const report = ctx(config, positional)
      // Leave a note for the Stop hook, so `kb done` needs no argument later.
      if (report.subject) rememberWork(config, positional)
      out(renderCtx(report, palette))
      return report.subject ? 0 : 1
    }

    case 'done': {
      // With no id, fall back to whatever `kb ctx` last opened. That is what lets the
      // Stop hook run `kb done --check` with no knowledge of the task.
      const workId = positional ?? recallWork(config)
      if (!workId) {
        // Nothing was claimed. Silence is still correct for a diff of docs, config or the
        // knowledge base — a hook that scolds on every unrelated turn gets switched off.
        // But INC-0001 showed that the same silence let six source files land in `apps/`
        // with no gate saying a word, because opening no work item bypassed everything.
        // So: speak when the diff touches governed code, and never fail the turn for it.
        const unclaimed = unclaimedWork(config, changedFiles)
        if (rest.includes('--check')) {
          if (unclaimed) out(renderUnclaimed(unclaimed, palette))
          return 0
        }
        err('usage: kb done <W-id> [--check]')
        return 2
      }
      const report = done(config, workId, changedFiles)
      out(renderDone(report, palette))
      // --check is the hook mode: report the gaps, never fail the agent's turn over them.
      return report.gaps.length > 0 && !rest.includes('--check') ? 1 : 0
    }

    case 'verify': {
      const report = verify(config)
      out(renderVerify(report, palette))
      const errors = report.findings.filter((f) => f.severity === 'error').length
      const warnings = report.findings.length - errors
      return errors > 0 || (rest.includes('--strict') && warnings > 0) ? 1 : 0
    }

    case 'why': {
      if (!positional) {
        err('usage: kb why <file|symbol|entity-id>')
        return 2
      }
      out(renderWhy(why(config, positional), palette))
      return 0
    }

    case 'guards': {
      if (!config.architecture) {
        err(
          'kb guards: no "architecture" block in anchoring.config.json — nothing to generate.\n\n' +
            'Example "architecture" block to add to anchoring.config.json:\n' +
            '{\n' +
            '  "architecture": {\n' +
            '    "layers": [\n' +
            '      { "name": "ui", "paths": ["src/ui/", "apps/"] },\n' +
            '      { "name": "domain", "paths": ["src/domain/"], "pure": true }\n' +
            '    ],\n' +
            '    "maxFileLines": 400,\n' +
            '    "maxFunctionLines": 50\n' +
            '  }\n' +
            '}',
        )
        return 1
      }

      const probe = defaultFsProbe(config.root)
      if (!probe('package.json')) {
        err('kb guards: generated checkers currently target TypeScript/JavaScript projects only.')
        return 1
      }

      const plan = planGuards(config)

      if (rest.includes('--dry-run')) {
        for (const file of plan.files) {
          out(`--- ${file.path} ---\n${file.body}`)
        }
        return 0
      }

      const io = defaultInitIo(config.root)

      if (rest.includes('--check')) {
        const results = checkGuards(plan, io.readFile)
        let allOk = true
        for (const res of results) {
          out(`${res.path}: ${res.state}`)
          if (res.state !== 'ok') {
            allOk = false
          }
        }
        const existingAgents = io.readFile('AGENTS.md')
        if (existingAgents !== undefined) {
          const agentsRes = updateAgentsMd(existingAgents, config.architecture)
          if (agentsRes.updated) {
            if (agentsRes.content !== existingAgents) {
              out('AGENTS.md: stale')
              allOk = false
            } else {
              out('AGENTS.md: ok')
            }
          }
        }
        return allOk ? 0 : 1
      }

      for (const file of plan.files) {
        io.writeFile(file.path, file.body)
        out(`kb guards: wrote ${file.path}`)
      }
      const existingAgents = io.readFile('AGENTS.md')
      if (existingAgents !== undefined) {
        const agentsRes = updateAgentsMd(existingAgents, config.architecture)
        if (agentsRes.updated) {
          if (agentsRes.content !== existingAgents) {
            io.writeFile('AGENTS.md', agentsRes.content)
            out('kb guards: updated AGENTS.md')
          }
        } else if (agentsRes.note) {
          out(agentsRes.note)
        }
      }
      for (const note of plan.notes) {
        out(`\n${note}`)
      }
      return 0
    }

    default:
      err(USAGE)
      return command === undefined || command === '--help' || command === '-h' ? 0 : 2
  }
}

/* c8 ignore start -- process wiring, exercised by running the binary */
const write =
  (stream: NodeJS.WriteStream) =>
  (text: string): void => {
    stream.write(`${text}\n`)
  }

const invokedAs = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedAs === fileURLToPath(import.meta.url)) {
  process.exit(run(process.argv.slice(2), write(process.stdout), write(process.stderr)))
}
/* c8 ignore stop */
