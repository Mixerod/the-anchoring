/**
 * Every byte `kb brief` emits.
 *
 * Split from `render.ts` for the reason rule 8 gives — two reasons to change. Everything in
 * `render.ts` is arranged for a human reading a terminal; everything here is arranged for a
 * cache prefix, and the two pull in opposite directions. Keeping them in one file would mean
 * a colour tweak could move the cacheable prefix.
 *
 * Pure module: takes a `Brief`, returns strings. No I/O, no clock, no palette — the bundle
 * carries no colour by construction, because escape sequences are tokens an agent pays for
 * and cannot use.
 */

import { TIER_LEVELS, type Brief, type BriefTier, type TierLevel } from './brief.js'

export const TIER_MARKER_PREFIX = '<!-- kb:brief:tier:'
export const DOC_MARKER_PREFIX = '<!-- kb:brief:doc '

/** UTF-8 bytes, which is what a file on disk and a request body are actually measured in. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

function tierMarker(level: TierLevel, label: string): string {
  return `${TIER_MARKER_PREFIX}${level} ${label} -->`
}

/**
 * The body of one tier, without its marker — the exact string a harness attaches one
 * `cache_control` breakpoint to, and the exact string the `--json` form carries.
 *
 * Tier 4 alone carries the counts and the session note. That placement is the whole design:
 * `(34 entities, 266 anchors)` in tier 1 would invalidate tiers 2, 3 and 4 on every commit
 * that adds a document, and nothing would report it.
 */
export function renderTierBody(tier: BriefTier, brief: Brief): string {
  const parts = tier.documents.map((doc) => `${DOC_MARKER_PREFIX}${doc.path} -->\n${doc.body}`)

  if (tier.level === 4) {
    const perKind = brief.counts.map((c) => `${c.kind} ${c.count}`).join(', ')
    const lines = [
      `${DOC_MARKER_PREFIX}(derived) -->`,
      `entities: ${brief.entityCount} (${perKind})`,
    ]
    if (brief.session !== undefined) lines.push(`session: ${brief.session}`)
    parts.push(`${lines.join('\n')}\n`)
  }

  if (parts.length === 0) return ''
  return parts.join('\n')
}

export function renderBrief(brief: Brief): string {
  return brief.tiers
    .map((tier) => {
      const body = renderTierBody(tier, brief)
      return `${tierMarker(tier.level, tier.label)}\n${body}`
    })
    .join('\n')
}

/**
 * The form a harness actually consumes: one object per tier, mapped straight onto one cache
 * breakpoint. The text form is the human view of the same bytes.
 */
export function renderBriefJson(brief: Brief): string {
  return JSON.stringify(
    {
      tiers: brief.tiers.map((tier) => ({
        level: tier.level,
        label: tier.label,
        content: renderTierBody(tier, brief),
      })),
      generated_from: brief.generatedFrom,
    },
    null,
    2,
  )
}

export interface TierSize {
  readonly level: TierLevel
  readonly bytes: number
}

export function briefSizes(brief: Brief): {
  readonly total: number
  readonly tiers: readonly TierSize[]
} {
  const text = renderBrief(brief)
  return {
    total: byteLength(text),
    tiers: brief.tiers.map((tier) => ({
      level: tier.level,
      bytes: byteLength(renderTierBody(tier, brief)),
    })),
  }
}

export interface StabilityResult {
  readonly stable: boolean
  /** UTF-8 byte offset of the first difference. Absent when stable. */
  readonly offset?: number
  readonly tier?: TierLevel
}

/** Which tier a UTF-16 index falls in: the level of the last tier marker at or before it. */
function tierAt(text: string, index: number): TierLevel | undefined {
  let found: TierLevel | undefined
  for (const level of TIER_LEVELS) {
    const at = text.indexOf(`${TIER_MARKER_PREFIX}${level} `)
    if (at !== -1 && at <= index) found = level
  }
  return found
}

/**
 * `kb brief --check`: two independent renders, compared byte for byte.
 *
 * This is the only cache guarantee this tool can make, and the boundary matters. `kb` never
 * calls a model, so it **cannot observe a cache hit**. It guarantees that the prefix does not
 * move. The harness verifies the hit by reading `usage.cache_read_input_tokens` and treating
 * a persistent zero as a defect. Do not let those two claims blur into one.
 */
export function compareRenders(a: string, b: string): StabilityResult {
  if (a === b) return { stable: true }

  const shared = Math.min(a.length, b.length)
  let i = 0
  while (i < shared && a.charCodeAt(i) === b.charCodeAt(i)) i++

  const tier = tierAt(a, i)
  return {
    stable: false,
    offset: byteLength(a.slice(0, i)),
    ...(tier !== undefined ? { tier } : {}),
  }
}
