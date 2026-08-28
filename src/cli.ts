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
import { findRepoRoot, loadConfig, realPath } from './root.js'
import { defaultFsProbe, defaultInitIo, findGitRoot, planInit, applyInit, type InitPlan } from './init.js'
import { planGuards, checkGuards } from './guards.js'
import { updateAgentsMd } from './agents.js'
import { planOwners } from './owners.js'
import { ask } from './ask.js'
import { verify } from './verify.js'
import { why } from './why.js'
import { ctx } from './ctx.js'
import { done, unclaimedWork } from './done.js'
import { USAGE, choosePalette, renderAsk, renderCtx, renderDone, renderNoProgress, renderUnclaimed, renderWhy, type ColourEnv } from './render.js'
import { gitChangedFiles, type ChangedFiles } from './git.js'
import { recallWork, rememberWork } from './session.js'
import { briefCommand } from './cli-brief.js'
import { progressNotice, verifyCommand } from './cli-verify.js'
import { runUpstream } from './cli-upstream.js'
import { packCommand } from './cli-pack.js'
import { promoteCommand } from './cli-promote.js'

/**
 * Whether this module is the program being run, rather than a module being imported.
 *
 * Comparing `resolve(argv[1])` to `fileURLToPath(import.meta.url)` is the obvious version
 * and it is wrong the moment the package is *installed* rather than run from its own
 * checkout. A package manager puts `node_modules/<pkg>` there as a symlink (pnpm always;
 * npm for a `link:` or `file:` dependency), and Node resolves an ESM module specifier to
 * its **real** path — so `import.meta.url` is the checkout while `argv[1]` is the link, the
 * two never match, and the CLI silently does nothing and exits 0. A gate that exits 0
 * having checked nothing is worse than one that fails: CI goes green on an empty run.
 *
 * INC-0002 in the first adopter's repository: `pnpm kb verify --strict` printed no output
 * and exited 0 against a 107-entity corpus. `the-anchoring` never saw it because it runs
 * itself through `tsx src/cli.ts`, where the two paths are the same file.
 *
 * So: compare real paths, and fall back to the literal comparison when the path cannot be
 * resolved — a missing file is not a reason to refuse to run.
 */
export function isDirectlyInvoked(
  argv1: string | undefined,
  moduleFile: string,
  realpath: (p: string) => string = realPath,
): boolean {
  if (!argv1) return false
  const invoked = resolve(argv1)
  return invoked === moduleFile || realpath(invoked) === realpath(moduleFile)
}

/**
 * The only place `process` is consulted for rendering.
 *
 * `--no-colour` is kept alongside `--no-color` because it already shipped; dropping a flag
 * that works is a breaking change nobody asked for.
 */
function colourEnv(rest: readonly string[]): ColourEnv {
  return {
    isTTY: Boolean(process.stdout.isTTY),
    // Present at *any* value, per the NO_COLOR convention — never tested for truthiness.
    noColorEnv: process.env['NO_COLOR'] !== undefined,
    noColorFlag: rest.includes('--no-color') || rest.includes('--no-colour'),
    colorFlag: rest.includes('--color') || rest.includes('--colour'),
  }
}

export function run(
  argv: readonly string[],
  out: (text: string) => void,
  err: (text: string) => void,
  root?: string,
  changedFiles: ChangedFiles = gitChangedFiles,
): number {
  const [command, ...rest] = argv
  const palette = choosePalette(colourEnv(rest))
  const positional = rest.find((a) => !a.startsWith('-'))

  if (command === 'pack') {
    const packRoot = root ?? findRepoRoot(process.cwd()) ?? process.cwd()
    return packCommand(rest, packRoot, out, err)
  }

  if (command === 'promote') {
    const promoteRoot = root ?? findRepoRoot(process.cwd()) ?? process.cwd()
    return promoteCommand(rest, promoteRoot, out, err)
  }

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

    let packArg: string | undefined
    const packIndex = rest.indexOf('--pack')
    if (packIndex !== -1 && rest[packIndex + 1]) {
      packArg = rest[packIndex + 1]
    } else {
      const packFlag = rest.find((a) => a.startsWith('--pack='))
      if (packFlag) {
        packArg = packFlag.slice('--pack='.length)
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
      plan = planInit(initRoot, { kbRoot: kbRootArg, dryRun, force, guards, pack: packArg }, probe)
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
    case 'ask': {
      let limit: number | undefined
      const limitIndex = rest.indexOf('--limit')
      let query = positional
      if (limitIndex !== -1) {
        const nextArg = rest[limitIndex + 1]
        if (nextArg !== undefined) {
          const parsed = parseInt(nextArg, 10)
          if (!isNaN(parsed) && parsed > 0) limit = parsed
          if (positional === nextArg) {
            query = rest.find((a, i) => !a.startsWith('-') && i !== limitIndex + 1)
          }
        }
      }
      if (!query) {
        err('usage: kb ask "<query>" [--json] [--limit <n>]')
        return 2
      }
      const report = ask(config, query, limit !== undefined ? { limit } : undefined)
      if (rest.includes('--json')) {
        out(JSON.stringify(report, null, 2))
        return 0
      }
      out(renderAsk(report, palette))
      return 0
    }

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
          const stalled = progressNotice(config, verify(config).findings)
          if (stalled) out(renderNoProgress(stalled, palette))
          return 0
        }
        err('usage: kb done <W-id> [--check]')
        return 2
      }
      const report = done(config, workId, changedFiles)
      out(renderDone(report, palette))
      if (rest.includes('--check')) {
        // Advisory, and never an exit code: a loop-detector that blocks a commit is one
        // that gets uninstalled, and then nothing is enforced at all. See fingerprint.ts.
        const stalled = progressNotice(config, verify(config).findings)
        if (stalled) out(renderNoProgress(stalled, palette))
      }
      // --check is the hook mode: report the gaps, never fail the agent's turn over them.
      return report.gaps.length > 0 && !rest.includes('--check') ? 1 : 0
    }

    case 'verify':
      return verifyCommand(config, rest, out, err, palette)

    case 'brief':
      return briefCommand(config, rest, out, err)

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

    case 'owners': {
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

    case 'upstream':
      return runUpstream(config, rest, out, err)

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

if (isDirectlyInvoked(process.argv[1], fileURLToPath(import.meta.url))) {
  process.exit(run(process.argv.slice(2), write(process.stdout), write(process.stderr)))
}
/* c8 ignore stop */
