/**
 * CLI command handler for `kb promote`.
 *
 * CLI layer: parses arguments, performs I/O, invokes pure planner, renders output.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { loadConfig } from './root.js'
import { loadStore } from './loader.js'
import { findPack } from './pack-source.js'
import { planPromote } from './promote.js'

function parsePromoteArgs(argv: readonly string[]): {
  readonly incidentId?: string | undefined
  readonly packName?: string | undefined
  readonly sourceUrl?: string | undefined
  readonly dryRun: boolean
} {
  let incidentId: string | undefined
  let packName: string | undefined
  let sourceUrl: string | undefined
  const dryRun = argv.includes('--dry-run')

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg) continue

    if (arg === '--dry-run') {
      continue
    } else if (arg === '--to-pack' && i + 1 < argv.length) {
      packName = argv[++i]
    } else if (arg.startsWith('--to-pack=')) {
      packName = arg.slice('--to-pack='.length)
    } else if (arg === '--source' && i + 1 < argv.length) {
      sourceUrl = argv[++i]
    } else if (arg.startsWith('--source=')) {
      sourceUrl = arg.slice('--source='.length)
    } else if (!arg.startsWith('-') && !incidentId) {
      incidentId = arg
    }
  }

  return { incidentId, packName, sourceUrl, dryRun }
}

export function promoteCommand(
  argv: readonly string[],
  root: string,
  log: (s: string) => void,
  err: (s: string) => void,
): number {
  const { incidentId, packName, sourceUrl, dryRun } = parsePromoteArgs(argv)

  if (!incidentId || !packName) {
    err('Usage: kb promote <INC-id> --to-pack <name> [--dry-run] [--source <url>]')
    return 1
  }

  const configResult = loadConfig(root)
  if (!configResult.ok) {
    err('anchoring.config.json not found')
    return 1
  }
  const config = configResult.config
  const store = loadStore(config)

  const incident = store.byId.get(incidentId)
  if (!incident) {
    err(`kb promote: incident \`${incidentId}\` not found`)
    return 1
  }
  if (incident.kind !== 'INC') {
    err(`kb promote: \`${incidentId}\` is a ${incident.kind}, not an incident`)
    return 1
  }

  const incidentPath = join(config.root, incident.path)
  let rawText: string | undefined
  if (existsSync(incidentPath)) {
    try {
      rawText = readFileSync(incidentPath, 'utf8')
    } catch {
      // ignore
    }
  }

  const found = findPack(packName)
  if (!found.ok) {
    err(`kb promote: ${found.error}`)
    return 1
  }

  const plan = planPromote(incident, rawText, found.pack, {
    toPack: packName,
    source: sourceUrl,
    dryRun,
    now: new Date(),
  })

  if (!plan.ok) {
    err(`kb promote: ${plan.reason}`)
    return 1
  }

  if (dryRun) {
    log(plan.hazard.body)
    for (const note of plan.notes) log(`kb promote: ${note}`)
    return 0
  }

  const targetDir = join(found.pack.origin, 'hazard')
  mkdirSync(targetDir, { recursive: true })
  const targetFile = join(targetDir, `${plan.hazard.id}.md`)
  writeFileSync(targetFile, plan.hazard.body)

  const displayPath = relative(config.root, targetFile).split('\\').join('/')
  log(`kb promote: wrote ${displayPath}`)
  for (const note of plan.notes) log(`kb promote: ${note}`)
  return 0
}
