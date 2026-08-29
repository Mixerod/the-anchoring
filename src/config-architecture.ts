/**
 * Architecture block types and validation.
 *
 * Defines the dependency matrix, module boundaries, size ceilings, and purity constraints
 * declared in `anchoring.config.json`.
 *
 * Semantics:
 * - `layers` is ordered, highest first. A layer may import from itself and from any layer
 *   below it. Importing upward is forbidden. This is docs/PLAN.md-style one-way dependency,
 *   made checkable.
 * - A path may belong to exactly one layer. Overlapping paths across two layers is a config
 *   error — otherwise the direction of an import becomes ambiguous and the checker lies.
 * - `pure: true` marks the layer that may not perform I/O. At most one layer may be `pure`.
 *   Generated as an ESLint `no-restricted-imports` over `impureImports`.
 * - `moduleRoots` are directories whose immediate children are modules. A file outside module
 *   `X` may import from `X` only through one of `entryPoints`. This is the "privacy violation"
 *   rule — a deep import compiles fine and is exactly what makes internals unchangeable later.
 * - `maxFileLines` / `maxFunctionLines` are the lagging backstop, not the primary rule. Emit
 *   them as ESLint `max-lines` and `max-lines-per-function`, both with
 *   `skipBlankLines: true, skipComments: true`, and `max-lines-per-function` disabled for
 *   `*.test.*` / `*.spec.*`.
 */

export interface Layer {
  readonly name: string
  /** repo-relative, POSIX. A directory keeps its trailing slash; a file has none. */
  readonly paths: readonly string[]
  readonly pure: boolean
}

/**
 * A directory path gets a trailing slash; a *file* path must not.
 *
 * This looks cosmetic and is not. Every generated checker builds a matcher by
 * concatenation - depcruise into `^src/render\.ts`, ESLint into a `src/render.ts` glob.
 * Appending `/` unconditionally produced `src/render.ts/`, which no file can ever be, so
 * **every layer rule and every size ceiling this tool generated matched nothing**:
 * `kb guards --check` said `ok`, `depcruise` found no violations, and a domain module
 * importing the app layer passed clean. See .anchor/incident/INC-0004.md.
 */
export function normaliseLayerPath(rawPath: string): string {
  if (rawPath.endsWith('/')) return rawPath
  // A final `.ext` is what distinguishes `src/render.ts` from a directory named `src/api`.
  return /\.[a-zA-Z0-9]+$/.test(rawPath) ? rawPath : `${rawPath}/`
}

export interface Architecture {
  readonly layers: readonly Layer[]
  readonly moduleRoots: readonly string[]
  readonly entryPoints: readonly string[]
  readonly maxFileLines: number
  readonly maxFunctionLines: number
  /**
   * Per-file exemptions from `maxFunctionLines`, each set to that file's longest function
   * *today*. The ratchet: a new file is checked at the real limit immediately, an exempt
   * file can never get worse, and the debt is a list that only shrinks.
   *
   * Every entry is pinned to the exact current worst by a test, so an entry cannot be
   * raised to make a regression pass, and cannot be left behind once the function is split.
   * An exemption nobody is forced to revisit is a limit that was quietly repealed.
   */
  readonly maxFunctionLinesBaseline: Readonly<Record<string, number>>
  readonly impureImports: readonly string[]
  /**
   * Files permitted to import `impureImports` directly - the I/O adapters themselves.
   *
   * This list used to live hand-written in the host's `eslint.config.js`, where it silently
   * replaced the generated rule entirely (flat config overrides per rule key; it does not
   * merge). Declaring it here keeps one source of truth and makes the exemptions reviewable
   * in the same file as the matrix they bend.
   */
  readonly ioExemptions: readonly string[]
  /**
   * Project-specific `no-restricted-syntax` selectors, emitted alongside the generated ones.
   *
   * They live in config rather than in the host's ESLint file for the same reason: two
   * config objects declaring one rule do not merge, so whichever is listed last wins and the
   * other vanishes without a word.
   */
  readonly restrictedSyntax: readonly RestrictedSyntax[]
  /**
   * The message on an impure-import violation. `{module}` is replaced with the specifier.
   *
   * Configurable because the sentence worth printing is the one naming *this project's*
   * invariant. A message that explains nothing teaches people to reach for an
   * eslint-disable rather than to move the import.
   */
  readonly ioMessage: string
}

export interface RestrictedSyntax {
  readonly selector: string
  readonly message: string
}

export const DEFAULT_ENTRY_POINTS: readonly string[] = [
  'index.ts',
  'index.tsx',
  'index.js',
]

export const DEFAULT_MAX_FILE_LINES = 400
export const DEFAULT_MAX_FUNCTION_LINES = 50

export const DEFAULT_IO_MESSAGE =
  'Import {module} only from a declared I/O adapter; elsewhere, pass the value in as an argument.'

export const DEFAULT_IMPURE_IMPORTS: readonly string[] = [
  'node:fs',
  'node:child_process',
  'node:http',
  'node:https',
  'node:crypto',
]

export const KNOWN_ARCHITECTURE_KEYS = [
  'layers',
  'moduleRoots',
  'entryPoints',
  'maxFileLines',
  'maxFunctionLines',
  'maxFunctionLinesBaseline',
  'impureImports',
  'ioExemptions',
  'restrictedSyntax',
  'ioMessage',
] as const

export const KNOWN_LAYER_KEYS = ['name', 'paths', 'pure'] as const

export function isInvalidPosixRelPath(path: string): boolean {
  return (
    path.startsWith('/') ||
    path.startsWith('\\') ||
    /^[a-zA-Z]:/.test(path) ||
    path.includes('..') ||
    path.includes('\\')
  )
}

/**
 * Per-file `max-lines-per-function` exemptions.
 *
 * Rejected rather than accepted silently: a non-integer, a zero, or a negative. An
 * exemption list is the one place where a typo reads as "this file is exempt from
 * everything", so it is the last place to be forgiving about shape.
 */
/**
 * A path may belong to exactly one layer.
 *
 * Overlap is a config error rather than a warning because it makes the direction of an
 * import ambiguous: if `src/a.ts` is both domain and app, every rule mentioning either layer
 * quietly means something different from what it reads like.
 */
function overlappingPaths(layers: readonly Layer[]): readonly string[] {
  const problems: string[] = []

  for (let i = 0; i < layers.length; i++) {
    const layerA = layers[i]
    if (!layerA) continue
    for (let j = i; j < layers.length; j++) {
      const layerB = layers[j]
      if (!layerB) continue
      for (let pAIdx = 0; pAIdx < layerA.paths.length; pAIdx++) {
        const pA = layerA.paths[pAIdx]
        if (!pA) continue
        for (let pBIdx = i === j ? pAIdx + 1 : 0; pBIdx < layerB.paths.length; pBIdx++) {
          const pB = layerB.paths[pBIdx]
          if (!pB) continue
          if (pA !== pB && !pA.startsWith(pB) && !pB.startsWith(pA)) continue
          problems.push(
            i === j
              ? `layer \`${layerA.name}\` has overlapping paths: \`${pA}\` and \`${pB}\``
              : `layers \`${layerA.name}\` and \`${layerB.name}\` claim overlapping paths (\`${pA}\` and \`${pB}\`)`,
          )
        }
      }
    }
  }
  return problems
}

function parseIoMessage(raw: unknown, problems: string[]): string {
  if (raw === undefined) return DEFAULT_IO_MESSAGE
  if (typeof raw !== 'string' || raw.trim() === '') {
    problems.push('`ioMessage` must be a non-empty string')
    return DEFAULT_IO_MESSAGE
  }
  return raw
}

function parseStringList(raw: unknown, name: string, problems: string[]): readonly string[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.some((x: unknown) => typeof x !== 'string' || x.trim() === '')) {
    problems.push(`\`${name}\` must be an array of non-empty strings`)
    return []
  }
  return raw as readonly string[]
}

function parseRestrictedSyntax(raw: unknown, problems: string[]): readonly RestrictedSyntax[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    problems.push('`restrictedSyntax` must be an array of { selector, message }')
    return []
  }

  const out: RestrictedSyntax[] = []
  for (const entry of raw as readonly unknown[]) {
    const obj = entry as { selector?: unknown; message?: unknown } | null
    if (
      obj === null ||
      typeof obj !== 'object' ||
      typeof obj.selector !== 'string' ||
      obj.selector.trim() === '' ||
      typeof obj.message !== 'string' ||
      obj.message.trim() === ''
    ) {
      // A selector with no message is a rule that fires and explains nothing, which is
      // how a checker teaches people to disable it rather than to fix the code.
      problems.push('each `restrictedSyntax` entry needs a non-empty `selector` and `message`')
      continue
    }
    out.push({ selector: obj.selector, message: obj.message })
  }
  return out
}

function parseBaseline(raw: unknown, problems: string[]): Readonly<Record<string, number>> {
  if (raw === undefined) return {}
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    problems.push('`maxFunctionLinesBaseline` must be an object of path -> line count')
    return {}
  }

  const baseline: Record<string, number> = {}
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isInvalidPosixRelPath(path)) {
      problems.push(
        `\`maxFunctionLinesBaseline\` key \`${path}\` must be a repo-relative POSIX path`,
      )
    } else if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      problems.push(`\`maxFunctionLinesBaseline.${path}\` must be a positive integer`)
    } else {
      baseline[path] = value
    }
  }
  return baseline
}

export function parseArchitecture(
  rawArch: unknown,
  problems: string[],
): Architecture | undefined {
  if (rawArch === null || typeof rawArch !== 'object' || Array.isArray(rawArch)) {
    problems.push('`architecture` must be an object')
    return undefined
  }

  const rawArchObj = rawArch as Record<string, unknown>

  for (const key of Object.keys(rawArchObj)) {
    if (!KNOWN_ARCHITECTURE_KEYS.includes(key as (typeof KNOWN_ARCHITECTURE_KEYS)[number])) {
      problems.push(
        `unknown key \`${key}\` under \`architecture\`; accepted keys are: ${KNOWN_ARCHITECTURE_KEYS.join(', ')}`,
      )
    }
  }

  const layers: Layer[] = []
  if (rawArchObj['layers'] !== undefined) {
    if (!Array.isArray(rawArchObj['layers'])) {
      problems.push('`architecture.layers` must be an array of objects')
    } else {
      const seenLayerNames = new Set<string>()
      let pureCount = 0

      for (let i = 0; i < rawArchObj['layers'].length; i++) {
        const rawLayer = rawArchObj['layers'][i]
        if (rawLayer === null || typeof rawLayer !== 'object' || Array.isArray(rawLayer)) {
          problems.push(`architecture.layers[${i}] must be an object`)
          continue
        }

        const rawLayerObj = rawLayer as Record<string, unknown>
        for (const k of Object.keys(rawLayerObj)) {
          if (!KNOWN_LAYER_KEYS.includes(k as (typeof KNOWN_LAYER_KEYS)[number])) {
            problems.push(
              `unknown key \`${k}\` under layer; accepted keys are: ${KNOWN_LAYER_KEYS.join(', ')}`,
            )
          }
        }

        let name = ''
        if (typeof rawLayerObj['name'] !== 'string' || rawLayerObj['name'].trim() === '') {
          problems.push(`layer at index ${i} has no non-empty name`)
        } else {
          name = rawLayerObj['name'].trim()
          if (seenLayerNames.has(name)) {
            problems.push(`two layers share the name \`${name}\``)
          } else {
            seenLayerNames.add(name)
          }
        }

        const paths: string[] = []
        if (
          !Array.isArray(rawLayerObj['paths']) ||
          rawLayerObj['paths'].length === 0 ||
          rawLayerObj['paths'].some((p: unknown) => typeof p !== 'string' || p.trim() === '')
        ) {
          problems.push(`layer \`${name || i}\` paths must be a non-empty array of non-empty strings`)
        } else {
          for (const rawPath of rawLayerObj['paths'] as readonly string[]) {
            if (isInvalidPosixRelPath(rawPath)) {
              problems.push(
                `layer \`${name || i}\` path \`${rawPath}\` must be a repo-relative POSIX path (cannot be absolute, contain \`..\`, or contain backslashes)`,
              )
            } else {
              paths.push(normaliseLayerPath(rawPath))
            }
          }
        }

        let pure = false
        if (rawLayerObj['pure'] !== undefined) {
          if (typeof rawLayerObj['pure'] !== 'boolean') {
            problems.push(`layer \`${name || i}\` pure must be a boolean`)
          } else {
            pure = rawLayerObj['pure']
          }
        }
        if (pure) {
          pureCount++
        }

        if (name) {
          layers.push({ name, paths, pure })
        }
      }

      if (pureCount > 1) {
        problems.push('more than one layer has pure: true')
      }

      problems.push(...overlappingPaths(layers))
    }
  }

  let moduleRoots: readonly string[] = []
  if (rawArchObj['moduleRoots'] !== undefined) {
    if (
      !Array.isArray(rawArchObj['moduleRoots']) ||
      rawArchObj['moduleRoots'].some((m: unknown) => typeof m !== 'string' || m.trim() === '')
    ) {
      problems.push('`moduleRoots` must be an array of non-empty strings')
    } else {
      const normalisedRoots: string[] = []
      for (const m of rawArchObj['moduleRoots'] as readonly string[]) {
        if (isInvalidPosixRelPath(m)) {
          problems.push(
            `\`moduleRoots\` \`${m}\` must be a repo-relative POSIX path (cannot be absolute, contain \`..\`, or contain backslashes)`,
          )
        } else {
          normalisedRoots.push(m.endsWith('/') ? m : `${m}/`)
        }
      }
      moduleRoots = normalisedRoots
    }
  }

  let entryPoints: readonly string[] = DEFAULT_ENTRY_POINTS
  if (rawArchObj['entryPoints'] !== undefined) {
    if (
      !Array.isArray(rawArchObj['entryPoints']) ||
      rawArchObj['entryPoints'].length === 0 ||
      rawArchObj['entryPoints'].some((e: unknown) => typeof e !== 'string' || e.trim() === '')
    ) {
      problems.push('`entryPoints` must be an array of non-empty strings')
    } else {
      entryPoints = rawArchObj['entryPoints'] as readonly string[]
    }
  }

  let impureImports: readonly string[] = DEFAULT_IMPURE_IMPORTS
  if (rawArchObj['impureImports'] !== undefined) {
    if (
      !Array.isArray(rawArchObj['impureImports']) ||
      rawArchObj['impureImports'].length === 0 ||
      rawArchObj['impureImports'].some((i: unknown) => typeof i !== 'string' || i.trim() === '')
    ) {
      problems.push('`impureImports` must be an array of non-empty strings')
    } else {
      impureImports = rawArchObj['impureImports'] as readonly string[]
    }
  }

  let maxFileLines: number = DEFAULT_MAX_FILE_LINES
  if (rawArchObj['maxFileLines'] !== undefined) {
    if (
      typeof rawArchObj['maxFileLines'] !== 'number' ||
      !Number.isInteger(rawArchObj['maxFileLines']) ||
      rawArchObj['maxFileLines'] <= 0
    ) {
      problems.push('`maxFileLines` must be a positive integer')
    } else if (rawArchObj['maxFileLines'] < 50) {
      problems.push(
        'maxFileLines must be at least 50 (a threshold nobody can meet is a threshold that gets switched off)',
      )
    } else {
      maxFileLines = rawArchObj['maxFileLines']
    }
  }

  let maxFunctionLines: number = DEFAULT_MAX_FUNCTION_LINES
  if (rawArchObj['maxFunctionLines'] !== undefined) {
    if (
      typeof rawArchObj['maxFunctionLines'] !== 'number' ||
      !Number.isInteger(rawArchObj['maxFunctionLines']) ||
      rawArchObj['maxFunctionLines'] <= 0
    ) {
      problems.push('`maxFunctionLines` must be a positive integer')
    } else if (rawArchObj['maxFunctionLines'] < 10) {
      problems.push(
        'maxFunctionLines must be at least 10 (a threshold nobody can meet is a threshold that gets switched off)',
      )
    } else {
      maxFunctionLines = rawArchObj['maxFunctionLines']
    }
  }

  const maxFunctionLinesBaseline = parseBaseline(rawArchObj['maxFunctionLinesBaseline'], problems)
  const ioExemptions = parseStringList(rawArchObj['ioExemptions'], 'ioExemptions', problems)
  const restrictedSyntax = parseRestrictedSyntax(rawArchObj['restrictedSyntax'], problems)
  const ioMessage = parseIoMessage(rawArchObj['ioMessage'], problems)

  return {
    layers,
    moduleRoots,
    entryPoints,
    maxFileLines,
    maxFunctionLines,
    maxFunctionLinesBaseline,
    impureImports,
    ioExemptions,
    restrictedSyntax,
    ioMessage,
  }
}
