/**
 * CLI command handlers for `kb pack *`.
 *
 * CLI layer: parses arguments and renders output.
 */

import { loadConfig } from './root.js'
import { planPack, checkPack, isAdopted, type Pack, type PackCheckResult } from './pack.js'
import type { AnchoringConfig } from './config.js'
import { applyPack, defaultPackIo, findPack, resolvePacks } from './pack-source.js'

function handleList(
  root: string,
  log: (s: string) => void,
  err: (s: string) => void,
): number {
  const resolved = resolvePacks()
  if (!resolved.ok) {
    err(`kb pack: ${resolved.error}`)
    return 1
  }

  if (resolved.packs.length === 0) {
    log('kb pack: no packs found')
    return 0
  }

  for (const pack of resolved.packs) {
    const invs = pack.files.filter((f) => f.kind === 'invariant').length
    const docs = pack.files.filter((f) => f.kind === 'doctrine').length
    const hazs = pack.files.filter((f) => f.kind === 'hazard').length
    const scripts = pack.files.filter((f) => f.kind === 'script').length
    log(`${pack.manifest.name} (${pack.manifest.version})`)
    log(`  source:       ${pack.origin}`)
    log(`  description:  ${pack.manifest.description}`)
    log(
      `  contents:     ${invs} invariant, ${docs} doctrines, ${hazs} hazards, ${scripts} script`,
    )
  }
  return 0
}

function handleAdd(
  argv: readonly string[],
  root: string,
  log: (s: string) => void,
  err: (s: string) => void,
): number {
  const dryRun = argv.includes('--dry-run')
  const force = argv.includes('--force')
  const name = argv.find((a) => !a.startsWith('-'))

  if (!name) {
    err('Usage: kb pack add <name> [--dry-run] [--force]')
    return 1
  }

  const configResult = loadConfig(root)
  if (!configResult.ok) {
    err('anchoring.config.json not found')
    return 1
  }
  const config = configResult.config

  const found = findPack(name)
  if (!found.ok) {
    err(`kb pack add: ${found.error}`)
    return 1
  }

  const io = defaultPackIo(root)
  const plan = planPack(found.pack, config, (p) => io.readFile(p), { force })

  if (plan.files.length === 0 && plan.skipped.length === 0 && plan.notes.length > 0) {
    for (const note of plan.notes) err(`kb pack add: ${note}`)
    return 1
  }

  if (dryRun) {
    for (const file of plan.files) log(`[dry-run] would write ${file.path}`)
    for (const s of plan.skipped) log(`[dry-run] skipped ${s.path} (${s.reason})`)
    for (const note of plan.notes) log(`kb pack add: ${note}`)
    return 0
  }

  const results = applyPack(plan, io)
  for (const res of results) {
    if (res.action === 'wrote') log(`wrote ${res.path}`)
    else if (res.action === 'unchanged') log(`unchanged ${res.path}`)
    else if (res.action === 'skipped') log(`skipped ${res.path} (${res.reason})`)
  }
  for (const note of plan.notes) log(`kb pack add: ${note}`)
  return 0
}

function renderCheckResult(res: PackCheckResult, log: (s: string) => void): void {
  log(`kb pack check: ${res.pack.name} (${res.pack.version})`)
  for (const file of res.files) {
    log(`  ${file.path.padEnd(50)} ${file.state}`)
  }
}

/**
 * Which packs `kb pack check` should look at, and which it is declining to.
 *
 * Naming an explicit pack checks it whether or not it was adopted — the user asked. With no
 * name, only adopted packs are checked; the rest are returned so the caller can print them.
 * See INC-0005.
 */
function selectPacksToCheck(
  name: string | undefined,
  config: AnchoringConfig,
  io: { readonly readFile: (p: string) => string | undefined },
):
  | { readonly ok: true; readonly packs: readonly Pack[]; readonly notAdopted: readonly string[] }
  | { readonly ok: false; readonly error: string } {
  if (name) {
    const found = findPack(name)
    return found.ok
      ? { ok: true, packs: [found.pack], notAdopted: [] }
      : { ok: false, error: found.error }
  }

  const resolved = resolvePacks()
  if (!resolved.ok) return { ok: false, error: resolved.error }

  const packs: Pack[] = []
  const notAdopted: string[] = []
  for (const pack of resolved.packs) {
    if (isAdopted(pack, config, (p) => io.readFile(p))) packs.push(pack)
    else notAdopted.push(pack.manifest.name)
  }
  return { ok: true, packs, notAdopted: notAdopted.sort() }
}

function handleCheck(
  argv: readonly string[],
  root: string,
  log: (s: string) => void,
  err: (s: string) => void,
): number {
  const strict = argv.includes('--strict')
  const name = argv.find((a) => !a.startsWith('-'))

  const configResult = loadConfig(root)
  if (!configResult.ok) {
    err('anchoring.config.json not found')
    return 1
  }
  const config = configResult.config

  const io = defaultPackIo(root)
  const selected = selectPacksToCheck(name, config, io)
  if (!selected.ok) {
    err(`kb pack check: ${selected.error}`)
    return 1
  }
  const packsToCheck = selected.packs

  if (selected.notAdopted.length > 0) {
    // The negative path, named. A filter whose rejections are invisible cannot be audited.
    log(`kb pack check: not adopted, so not checked: ${selected.notAdopted.join(', ')}`)
  }

  let hasDrift = false
  for (const pack of packsToCheck) {
    const checkRes = checkPack(pack, config, (p) => io.readFile(p))
    renderCheckResult(checkRes, log)
    if (checkRes.files.some((f) => f.state !== 'ok')) {
      hasDrift = true
    }
  }

  if (strict && hasDrift) {
    return 1
  }
  return 0
}

export function packCommand(
  argv: readonly string[],
  root: string,
  log: (s: string) => void,
  err: (s: string) => void,
): number {
  const sub = argv[0]
  const rest = argv.slice(1)

  if (sub === 'list') {
    return handleList(root, log, err)
  }
  if (sub === 'add') {
    return handleAdd(rest, root, log, err)
  }
  if (sub === 'check') {
    return handleCheck(rest, root, log, err)
  }

  err(`Usage: kb pack <list|add|check> [options]`)
  return 1
}
