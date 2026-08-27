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

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

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

/** Frontmatter list fields accept a bare scalar or a list; normalise to strings. */
export function toList(value: unknown): readonly string[] {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) return value.map((v) => String(v))
  return [String(value)]
}
