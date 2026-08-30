/**
 * Lexical tokenising and weighted field overlap.
 *
 * Extracted from `ask.ts` when doctrine became rankable. Two things are now scored against
 * a query — entities and doctrine files — and the alternative to sharing this module was
 * two tokenisers with two stopword lists, drifting apart at the speed of whichever one was
 * edited last. "One concept, one name, everywhere" applies to code as much as to nouns.
 *
 * Pure module: string -> tokens. No I/O, no clock, no config.
 */

export const STOPWORDS = new Set([
  'a',
  'about',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'has',
  'have',
  'in',
  'is',
  'it',
  'its',
  'not',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'was',
  'were',
  'will',
  'with',
])

/** Lowercase alphanumeric runs, stopwords dropped. */
export function tokenise(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
}

/**
 * A query of nothing but stopwords is still a query someone typed.
 *
 * Dropping every token would score everything zero and report "no matches", which reads as
 * "nothing in this repository is relevant" rather than "your query was all stopwords".
 */
export function extractQueryTokens(query: string): readonly string[] {
  const filtered = tokenise(query)
  if (filtered.length > 0) return filtered
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0)
}

/**
 * Fraction of the field's own tokens that the query hit.
 *
 * Length-normalised on the *field*, not the query, so a concise title beats a diluted one
 * on the same number of hits. Without it, the longest document wins every query, which is
 * the opposite of what a retrieval layer built to save reading is for.
 */
export function fieldOverlap(
  fieldTokens: readonly string[],
  queryTokens: readonly string[],
): number {
  if (fieldTokens.length === 0 || queryTokens.length === 0) return 0
  let matches = 0
  for (const q of queryTokens) {
    if (fieldTokens.includes(q)) {
      matches += 1
    }
  }
  return matches / fieldTokens.length
}

/** A frontmatter list field may arrive as a JSON array string or a bare string. */
export function listTokens(raw: string | undefined): readonly string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed.flatMap((item) => tokenise(String(item)))
    }
  } catch {
    // raw was a bare string rather than JSON
  }
  return tokenise(raw)
}
