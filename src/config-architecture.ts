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
  readonly paths: readonly string[]     // repo-relative, POSIX, trailing slash
  readonly pure: boolean
}

export interface Architecture {
  readonly layers: readonly Layer[]
  readonly moduleRoots: readonly string[]
  readonly entryPoints: readonly string[]
  readonly maxFileLines: number
  readonly maxFunctionLines: number
  readonly impureImports: readonly string[]
}

export const DEFAULT_ENTRY_POINTS: readonly string[] = [
  'index.ts',
  'index.tsx',
  'index.js',
]

export const DEFAULT_MAX_FILE_LINES = 400
export const DEFAULT_MAX_FUNCTION_LINES = 50

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
  'impureImports',
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
              const normalised = rawPath.endsWith('/') ? rawPath : `${rawPath}/`
              paths.push(normalised)
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

      // Check overlapping paths across layers and within the same layer
      for (let i = 0; i < layers.length; i++) {
        const layerA = layers[i]
        if (!layerA) continue
        for (let j = i; j < layers.length; j++) {
          const layerB = layers[j]
          if (!layerB) continue
          for (let pAIdx = 0; pAIdx < layerA.paths.length; pAIdx++) {
            const pA = layerA.paths[pAIdx]
            if (!pA) continue
            const startPBIdx = i === j ? pAIdx + 1 : 0
            for (let pBIdx = startPBIdx; pBIdx < layerB.paths.length; pBIdx++) {
              const pB = layerB.paths[pBIdx]
              if (!pB) continue
              if (pA === pB || pA.startsWith(pB) || pB.startsWith(pA)) {
                if (i === j) {
                  problems.push(
                    `layer \`${layerA.name}\` has overlapping paths: \`${pA}\` and \`${pB}\``,
                  )
                } else {
                  problems.push(
                    `layers \`${layerA.name}\` and \`${layerB.name}\` claim overlapping paths (\`${pA}\` and \`${pB}\`)`,
                  )
                }
              }
            }
          }
        }
      }
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

  return {
    layers,
    moduleRoots,
    entryPoints,
    maxFileLines,
    maxFunctionLines,
    impureImports,
  }
}
