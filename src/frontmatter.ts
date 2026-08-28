/**
 * Frontmatter parsing.
 *
 * Tier 1 of progressive disclosure: this is the ~50 tokens per document that let an
 * agent decide what to read without reading anything. Keep it cheap — no file body is
 * ever parsed here.
 *
 * Pure module: string -> Frontmatter. File reading is delegated to infra/loader.ts.
 */

import { load } from 'js-yaml'

const FENCE = /^(?:<!--[\s\S]*?-->\r?\n\s*)*---\r?\n([\s\S]*?)\r?\n---\r?\n?/

export type Frontmatter = Readonly<Record<string, unknown>>

export type ParseResult =
  | { readonly ok: true; readonly data: Frontmatter }
  | { readonly ok: false; readonly reason: string }

export function parseFrontmatter(text: string): ParseResult {
  const match = FENCE.exec(text)
  if (!match?.[1]) return { ok: false, reason: 'no YAML frontmatter block' }

  let parsed: unknown
  try {
    parsed = load(match[1])
  } catch (error) {
    return { ok: false, reason: `invalid YAML: ${(error as Error).message}` }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'frontmatter must be a YAML mapping' }
  }
  return { ok: true, data: parsed as Frontmatter }
}

/**
 * Everything after the frontmatter fence — the prose an agent actually pays to read.
 *
 * Measured rather than parsed: the body's *size* is a budget, and nothing here needs to know
 * what is in it. Returns the whole text when there is no fence, because a document that
 * failed to parse still costs what it costs.
 */
export function bodyAfterFrontmatter(text: string): string {
  const match = FENCE.exec(text)
  return match ? text.slice(match[0].length) : text
}

/** UTF-8 bytes, which is what the file on disk and the request body are measured in. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** Frontmatter list fields accept a bare scalar or a list; normalise to strings. */
export function toList(value: unknown): readonly string[] {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) return value.map((v) => String(v))
  return [String(value)]
}
