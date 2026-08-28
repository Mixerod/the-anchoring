/**
 * `kb promote` — promoting local incidents into portable pack hazards.
 *
 * Purity is the redaction mechanism: `planPromote` performs no I/O, reads no filesystem,
 * and calls no clock. A function that cannot read a file cannot leak one — no local source
 * lines, no diffs, no secrets, no absolute paths.
 *
 * Promoted hazards are written with `resolution: not-applicable` and a reason stating they
 * are untriaged in the adopting repository. This avoids the 30-day clock and ceiling trap
 * when seeded into downstream projects.
 */

import type { Entity } from './store.js'
import type { Pack, PackFile } from './pack.js'

export interface ExistingHazard {
  readonly id: string
  readonly promotedFrom?: string | undefined
}

export interface PromoteOptions {
  readonly toPack: string
  readonly now: Date
  readonly source?: string | undefined
  readonly dryRun?: boolean | undefined
  readonly reason?: string | undefined
}

export interface PromotedHazard {
  readonly id: string
  readonly packName: string
  readonly relativePath: string
  readonly body: string
  readonly isExisting: boolean
}

export type PromotePlan =
  | { readonly ok: false; readonly reason: string }
  | {
      readonly ok: true
      readonly hazard: PromotedHazard
      readonly notes: readonly string[]
    }

const URL_PATTERN = /^https?:\/\/\S+$/
const PROMOTED_FROM_REGEX = /(?:promoted_from|about):\s*(INC-\d{4})|<!--\s*promoted-from:\s*(INC-\d{4})\s*-->/i

export function extractExistingHazards(files: readonly PackFile[]): readonly ExistingHazard[] {
  const hazards: ExistingHazard[] = []
  for (const file of files) {
    if (file.kind !== 'hazard') continue
    const idMatch = file.body.match(/^id:\s*(HAZ-\d{4})$/m) ?? file.basename.match(/^(HAZ-\d{4})\.md$/)
    if (!idMatch || !idMatch[1]) continue
    const id = idMatch[1]
    const fromMatch = file.body.match(PROMOTED_FROM_REGEX)
    const promotedFrom = fromMatch ? (fromMatch[1] ?? fromMatch[2]) : undefined
    hazards.push({ id, promotedFrom })
  }
  return hazards
}

export function nextHazardId(existing: readonly string[]): string {
  const taken = new Set(existing)
  let next = 1
  let id = `HAZ-${String(next).padStart(4, '0')}`
  while (taken.has(id)) {
    next += 1
    id = `HAZ-${String(next).padStart(4, '0')}`
  }
  return id
}

function extractProseBody(rawText: string, hazardId: string, title: string): string {
  const lines = rawText.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') {
    return `# ${hazardId}: ${title}\n\n${rawText.trim()}`
  }

  const closing = lines.findIndex((line, i) => i > 0 && line.trim() === '---')
  if (closing === -1) {
    return `# ${hazardId}: ${title}\n\n${rawText.trim()}`
  }

  const afterFrontmatter = lines.slice(closing + 1).join('\n').trim()
  if (!afterFrontmatter) {
    return `# ${hazardId}: ${title}\n`
  }

  if (/^#\s*INC-\d+[:\s]/i.test(afterFrontmatter)) {
    return afterFrontmatter.replace(/^#\s*INC-\d+[:\s].*$/m, `# ${hazardId}: ${title}`)
  }

  return `# ${hazardId}: ${title}\n\n${afterFrontmatter}`
}

function renderHazardFrontmatter(
  hazardId: string,
  incident: Entity,
  sourceUrl: string,
  observedDate: string,
  recordedDate: string,
  reason: string,
): string {
  const lines = [
    '---',
    `id: ${hazardId}`,
    `title: ${incident.title}`,
    'status: active',
    `source: ${sourceUrl}`,
    `observed: ${observedDate}`,
    `recorded: ${recordedDate}`,
    'resolution: not-applicable',
    `reason: ${reason}`,
    'holds_for: []',
    'resolves_to: []',
  ]

  const rawTags = incident.fields['tags']
  if (rawTags) {
    try {
      const parsed = JSON.parse(rawTags)
      if (Array.isArray(parsed) && parsed.length > 0) {
        lines.push('tags:')
        for (const tag of parsed) {
          lines.push(`  - ${String(tag)}`)
        }
      }
    } catch {
      // ignore
    }
  }

  lines.push(`promoted_from: ${incident.id}`)
  lines.push('---')
  return lines.join('\n')
}

export function planPromote(
  incident: Entity,
  incidentRawText: string | undefined,
  pack: Pack,
  options: PromoteOptions,
): PromotePlan {
  if (incident.kind !== 'INC') {
    return { ok: false, reason: `${incident.id} is a ${incident.kind}, not an incident` }
  }

  const sourceUrl =
    options.source ??
    incident.fields['source'] ??
    (incident.fields['upstream'] && URL_PATTERN.test(incident.fields['upstream'])
      ? incident.fields['upstream']
      : undefined)

  if (!sourceUrl) {
    return {
      ok: false,
      reason: `incident ${incident.id} carries no upstream evidence to derive source from; supply --source <url>`,
    }
  }

  if (!URL_PATTERN.test(sourceUrl)) {
    return {
      ok: false,
      reason: `source URL \`${sourceUrl}\` must be an http(s) URL`,
    }
  }

  const existingHazards = extractExistingHazards(pack.files)
  const existingPromotion = existingHazards.find((h) => h.promotedFrom === incident.id)

  const isExisting = existingPromotion !== undefined
  const hazardId = existingPromotion
    ? existingPromotion.id
    : nextHazardId(existingHazards.map((h) => h.id))

  const now = options.now
  const recordedDate = now.toISOString().slice(0, 10)
  const observedDate = incident.fields['upstream_recorded'] ?? incident.fields['observed'] ?? recordedDate
  const reason = options.reason ?? 'not yet triaged in this repository'

  const frontmatter = renderHazardFrontmatter(
    hazardId,
    incident,
    sourceUrl,
    observedDate,
    recordedDate,
    reason,
  )

  const prose = incidentRawText
    ? extractProseBody(incidentRawText, hazardId, incident.title)
    : `# ${hazardId}: ${incident.title}\n`

  const body = `${frontmatter}\n\n${prose}\n`
  const relativePath = `hazard/${hazardId}.md`

  const notes: string[] = []
  if (isExisting) {
    notes.push(`${incident.id} already promoted to ${pack.manifest.name} as ${hazardId}`)
  }

  return {
    ok: true,
    hazard: {
      id: hazardId,
      packName: pack.manifest.name,
      relativePath,
      body,
      isExisting,
    },
    notes,
  }
}
