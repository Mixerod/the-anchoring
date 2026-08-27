/**
 * `kb upstream` — the I/O half.
 *
 * Every filesystem touch the upstream loop makes lives here, so that `upstream.ts` can
 * stay pure. That split is not tidiness: a pure planner cannot read a source file, a diff,
 * or an environment variable, so it cannot put one in a report. The redaction guarantee is
 * structural, and this module is the boundary it is structural *at*.
 *
 * **No network call, from any path in this file, for any reason.** The upstream loop is
 * carried by a person. See docs/THE_ANCHORING.md, "The upstream loop".
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defaultInitIo } from './init.js'
import { loadStore } from './loader.js'
import { loadConfig } from './root.js'
import { gitIsDirty, type IsDirty } from './git.js'
import type { Store } from './store.js'
import {
  UPSTREAM_BANNER,
  checkUpstream,
  listUpstream,
  planOpenWork,
  planUpstream,
  type ExistingReport,
  type PackageFacts,
  type UpstreamPlan,
} from './upstream.js'
import type { AnchoringConfig } from './config.js'

/**
 * The installed package's own name and version, read once and passed in.
 *
 * `planUpstream` takes these as an argument for the same reason every other I/O boundary
 * in this codebase is an argument: so the pure half stays testable and cannot reach out.
 */
export function readPackageFacts(): PackageFacts {
  /* c8 ignore start -- reads this package's own manifest; the fallback is the tested path */
  try {
    const here = dirname(fileURLToPath(import.meta.url))
    for (const candidate of [join(here, '../package.json'), join(here, '../../package.json')]) {
      if (existsSync(candidate)) {
        const raw = JSON.parse(readFileSync(candidate, 'utf8')) as {
          name?: string
          version?: string
        }
        if (raw.name) return { name: raw.name, version: raw.version ?? '0.0.0' }
      }
    }
  } catch {
    // fall through
  }
  return { name: 'the-anchoring', version: '0.0.0' }
  /* c8 ignore stop */
}

/**
 * The reports already on disk, as `{ id, about }` pairs.
 *
 * The pairing, not just the id: an incident that already has a report must keep the same
 * `UP-` id on every run, or `--check` allocates a fresh one and reports the old file
 * `missing` forever. Read with a line match rather than a YAML parse — the frontmatter of
 * a generated file is two known lines, and this must not fail on a file a person has
 * annotated.
 */
export function readExistingReports(root: string, dir: string): readonly ExistingReport[] {
  let names: readonly string[]
  try {
    names = readdirSync(join(root, dir)).filter((n) => /^UP-\d{4}\.md$/.test(n))
  } catch {
    return [] // no reports yet is normal, not an error
  }

  const found: ExistingReport[] = []
  for (const name of names) {
    try {
      const about = readFileSync(join(root, dir, name), 'utf8').match(/^about: (\S+)$/m)?.[1]
      if (about) found.push({ id: name.replace(/\.md$/, ''), about })
    } catch {
      // an unreadable report is not a reason to renumber every other one
    }
  }
  return found
}

/**
 * `--open-work <path>` — open the work item in the upstream repository, and stop.
 *
 * Every refusal below is a refusal to write into somebody else's repository on a guess.
 * MUST NOT: edit any other file upstream, run its tests, install anything, commit, push,
 * or open a pull request. It writes exactly two files — one new `W-` upstream, and the
 * `upstream_work:` line in the downstream incident — and prints both paths.
 */
function openWork(
  config: AnchoringConfig,
  plan: UpstreamPlan,
  store: Store,
  target: string,
  out: (text: string) => void,
  err: (text: string) => void,
  isDirty: IsDirty,
): number {
  const upstreamRoot = resolve(config.root, target)

  if (!existsSync(join(upstreamRoot, 'anchoring.config.json'))) {
    err(`kb upstream --open-work: ${target} has no anchoring.config.json`)
    return 1
  }

  // Before anything else: never write into a tree somebody is mid-change in. `undefined`
  // means git could not tell, and "could not tell" is not permission.
  const dirty = isDirty(upstreamRoot)
  if (dirty !== false) {
    err(
      dirty === undefined
        ? `kb upstream --open-work: cannot read git status in ${target}; refusing to write`
        : `kb upstream --open-work: ${target} has uncommitted changes; commit or stash them first`,
    )
    return 1
  }

  const upstreamConfig = loadConfig(upstreamRoot)
  if (!upstreamConfig.ok) {
    for (const problem of upstreamConfig.problems) err(`upstream config error: ${problem}`)
    return 1
  }

  const workDir = upstreamConfig.config.kinds.WORK.dir
  const workFiles = listWorkFiles(upstreamRoot, workDir)
  const upstreamFacts = {
    hasConfig: true,
    packageName: readPackageName(upstreamRoot),
    workDir,
    existingWorkIds: workFiles.map((f) => f.id),
    workTexts: workFiles.map((f) => f.text),
  }
  const downstreamDirName = basename(config.root)

  let wrote = 0
  for (const report of plan.reports) {
    const incident = store.byId.get(report.about)
    if (!incident) continue
    if (incident.fields['upstream_work']) continue

    const incidentText = readFileSync(join(config.root, incident.path), 'utf8')
    const decision = planOpenWork(report, incident, incidentText, upstreamFacts, downstreamDirName)

    if (!decision.ok) {
      err(`kb upstream --open-work: ${report.id}: ${decision.reason}`)
      return 1
    }

    writeFileSync(join(upstreamRoot, decision.workPath), decision.workBody)
    writeFileSync(join(config.root, decision.incidentPath), decision.incidentBody)
    out(`kb upstream: wrote ${join(target, decision.workPath).split('\\').join('/')}`)
    out(`kb upstream: wrote ${decision.incidentPath}`)

    // Keep the in-memory facts current so a second report in the same run does not
    // allocate the same W- id.
    upstreamFacts.existingWorkIds = [...upstreamFacts.existingWorkIds, decision.workId]
    upstreamFacts.workTexts = [...upstreamFacts.workTexts, decision.workBody]
    wrote += 1
  }

  if (wrote === 0) out('kb upstream: every escalated incident already has a work item.')
  // Nothing is committed, in either repository. That is the caller's decision.
  return 0
}

function readPackageName(root: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: string }).name
  } catch {
    return undefined
  }
}

function listWorkFiles(
  root: string,
  workDir: string,
): readonly { readonly id: string; readonly text: string }[] {
  let names: readonly string[]
  try {
    names = readdirSync(join(root, workDir)).filter((n) => /^W-\d+\.md$/.test(n))
  } catch {
    return []
  }
  return names.flatMap((name) => {
    try {
      return [{ id: name.replace(/\.md$/, ''), text: readFileSync(join(root, workDir, name), 'utf8') }]
    } catch {
      return []
    }
  })
}

/** `--open-work <path>` or `--open-work=<path>`. */
function openWorkTarget(rest: readonly string[]): string | undefined {
  const i = rest.indexOf('--open-work')
  if (i !== -1) return rest[i + 1]
  return rest.find((a) => a.startsWith('--open-work='))?.slice('--open-work='.length)
}

export function runUpstream(
  config: AnchoringConfig,
  rest: readonly string[],
  out: (text: string) => void,
  err: (text: string) => void = out,
  isDirty: IsDirty = gitIsDirty,
): number {
  const io = defaultInitIo(config.root)
  const store = loadStore(config)

  if (rest.includes('--list')) {
    // The `local` and `unclear` rows are the point. A tool that only ever displays what it
    // escalated cannot be audited for over-attribution, and over-attribution is this
    // feature's main failure mode.
    const rows = listUpstream(store)
    if (rows.length === 0) {
      out('kb upstream: no incidents recorded.')
      return 0
    }
    out('Incident   Verdict   Package          Evidence             Why')
    out(
      '---------- --------- ---------------- -------------------- ---------------------------------------',
    )
    for (const r of rows) {
      out(
        `${r.id.padEnd(10)} ${r.verdict.padEnd(9)} ${r.pkg.padEnd(16)} ${r.evidence.padEnd(20)} ${r.reason}`,
      )
    }
    return 0
  }

  const plan = planUpstream(
    config,
    store,
    readPackageFacts(),
    readExistingReports(config.root, `${config.kbRoot}/upstream`),
  )

  const target = openWorkTarget(rest)
  if (target !== undefined) {
    return openWork(config, plan, store, target, out, err, isDirty)
  }

  if (rest.includes('--dry-run')) {
    for (const report of plan.reports) {
      out(`--- ${report.path} ---\n${report.body}`)
    }
    for (const note of plan.notes) {
      out(note)
    }
    return 0
  }

  if (rest.includes('--check')) {
    let allOk = true
    for (const res of checkUpstream(plan, io.readFile)) {
      out(`${res.path}: ${res.state}`)
      if (res.state !== 'ok') allOk = false
    }
    // A loop nobody closed is the failure this feature exists to stop, so `--check` fails
    // on it too — not only on a file that drifted.
    for (const row of listUpstream(store)) {
      if (row.verdict === 'upstream' && row.reason === 'escalated, no work item opened') {
        out(`${row.id}: escalated to \`${row.pkg}\` with no work item opened`)
        allOk = false
      }
    }
    if (plan.reports.length === 0) out('kb upstream: nothing to check.')
    return allOk ? 0 : 1
  }

  for (const report of plan.reports) {
    io.writeFile(report.path, report.body)
    out(`kb upstream: wrote ${report.path}`)
  }
  for (const note of plan.notes) {
    out(note)
  }
  if (plan.reports.length > 0) out(`\n${UPSTREAM_BANNER}`)
  return 0
}
