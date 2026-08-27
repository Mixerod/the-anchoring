#!/usr/bin/env -S npx tsx
/**
 * kb — the intent graph over this repository.
 *
 *   kb verify [--strict]   check every claim the docs make about the code
 *   kb why <target>        what a file, symbol, or entity is for
 *
 * This file only routes. Checking lives in verify.ts, the reverse walk in why.ts,
 * and every byte of output in render.ts. Rationale:
 * .agent/rules/15-retrieval.md and docs/adr/0013-knowledge-base-and-retrieval.md.
 */

import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { verify } from './verify.js'
import { why } from './why.js'
import { ctx } from './ctx.js'
import { done, unclaimedWork } from './done.js'
import { COLOUR, PLAIN, USAGE, renderCtx, renderDone, renderUnclaimed, renderVerify, renderWhy } from './render.js'
import { gitChangedFiles, type ChangedFiles } from './git.js'
import { recallWork, rememberWork } from './session.js'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

export function run(
  argv: readonly string[],
  out: (text: string) => void,
  err: (text: string) => void,
  root: string = REPO_ROOT,
  changedFiles: ChangedFiles = gitChangedFiles,
): number {
  const [command, ...rest] = argv
  const palette = rest.includes('--no-colour') ? PLAIN : COLOUR
  const positional = rest.find((a) => !a.startsWith('-'))

  switch (command) {
    case 'ctx': {
      if (!positional) {
        err('usage: kb ctx <W-id>')
        return 2
      }
      const report = ctx(root, positional)
      // Leave a note for the Stop hook, so `kb done` needs no argument later.
      if (report.subject) rememberWork(root, positional)
      out(renderCtx(report, palette))
      return report.subject ? 0 : 1
    }

    case 'done': {
      // With no id, fall back to whatever `kb ctx` last opened. That is what lets the
      // Stop hook run `kb done --check` with no knowledge of the task.
      const workId = positional ?? recallWork(root)
      if (!workId) {
        // Nothing was claimed. Silence is still correct for a diff of docs, config or the
        // knowledge base — a hook that scolds on every unrelated turn gets switched off.
        // But INC-0001 showed that the same silence let six source files land in `apps/`
        // with no gate saying a word, because opening no work item bypassed everything.
        // So: speak when the diff touches governed code, and never fail the turn for it.
        const unclaimed = unclaimedWork(changedFiles, root)
        if (rest.includes('--check')) {
          if (unclaimed) out(renderUnclaimed(unclaimed, palette))
          return 0
        }
        err('usage: kb done <W-id> [--check]')
        return 2
      }
      const report = done(root, workId, changedFiles)
      out(renderDone(report, palette))
      // --check is the hook mode: report the gaps, never fail the agent's turn over them.
      return report.gaps.length > 0 && !rest.includes('--check') ? 1 : 0
    }

    case 'verify': {
      const report = verify(root)
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
      out(renderWhy(why(root, positional), palette))
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
