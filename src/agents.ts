/**
 * AGENTS.md generation and maintenance.
 *
 * Keeps the agent brief in sync with the declared architecture matrix
 * in anchoring.config.json.
 */

import {
  DEFAULT_ENTRY_POINTS,
  DEFAULT_MAX_FILE_LINES,
  DEFAULT_MAX_FUNCTION_LINES,
  type Architecture,
} from './config.js'

export const ARCHITECTURE_START_MARKER = '<!-- kb:architecture:start -->'
export const ARCHITECTURE_END_MARKER = '<!-- kb:architecture:end -->'

export function generateArchitectureSection(
  arch?: Partial<Architecture> | Architecture,
): string {
  const sections: string[] = []

  if (arch && arch.layers && arch.layers.length > 0) {
    const layerNames = arch.layers.map((l) => (l.pure ? `${l.name} (pure)` : l.name))
    const diagramLines = layerNames.join('\n  ↓\n')

    sections.push(`### Layer Order

\`\`\`
${diagramLines}
\`\`\`

- Dependencies point one way, down the layer order. Importing upward is forbidden (\`INV-DEP-DIRECTION\`).
- The dependency graph must remain acyclic (\`INV-NO-CYCLES\`).`)
  }

  const rules: string[] = []

  if (arch && arch.moduleRoots && arch.moduleRoots.length > 0) {
    const entryPoints =
      arch.entryPoints && arch.entryPoints.length > 0
        ? arch.entryPoints
        : DEFAULT_ENTRY_POINTS
    rules.push(
      `- Cross-module imports must go through declared entry points (${entryPoints.join(', ')}) (\`INV-MODULE-ENTRY\`).`,
    )
  }

  const pureLayer = arch?.layers?.find((l) => l.pure)
  if (pureLayer) {
    rules.push(
      `- The pure layer (\`${pureLayer.name}\`) performs no I/O; every non-deterministic input is an argument (\`INV-PURE-CORE\`).`,
    )
  }

  if (arch) {
    const maxFile = arch.maxFileLines ?? DEFAULT_MAX_FILE_LINES
    const maxFunc = arch.maxFunctionLines ?? DEFAULT_MAX_FUNCTION_LINES
    rules.push(
      `- Files must stay under ${maxFile} lines and functions under ${maxFunc} lines (\`INV-FILE-SIZE\`).`,
    )
  }

  if (rules.length > 0) {
    sections.push(`### Enforced Invariants\n\n${rules.join('\n')}`)
  }

  sections.push(`### Non-Machine-Checked Principles
- **UI and controllers only move data**: No domain logic in presentation, UI components, or routing.
- **One concept, one name, everywhere**: Use consistent domain terminology across types, doc comments, and UI.
- **Split on two reasons to change, not on line count**: Organize by cohesion and single responsibility, not by arbitrary line counts.`)

  return sections.join('\n\n')
}

export function renderAgentsMd(
  template: string,
  arch?: Partial<Architecture> | Architecture,
): string {
  const archSection = generateArchitectureSection(arch)
  const replacement = `${ARCHITECTURE_START_MARKER}\n${archSection}\n${ARCHITECTURE_END_MARKER}`

  if (template.includes(ARCHITECTURE_START_MARKER) && template.includes(ARCHITECTURE_END_MARKER)) {
    const startIdx = template.indexOf(ARCHITECTURE_START_MARKER)
    const endIdx = template.indexOf(ARCHITECTURE_END_MARKER) + ARCHITECTURE_END_MARKER.length
    return template.slice(0, startIdx) + replacement + template.slice(endIdx)
  }

  return template
}

export interface UpdateAgentsResult {
  readonly content: string
  readonly updated: boolean
  readonly note?: string
}

export function updateAgentsMd(
  existingContent: string,
  arch?: Partial<Architecture> | Architecture,
): UpdateAgentsResult {
  if (
    !existingContent.includes(ARCHITECTURE_START_MARKER) ||
    !existingContent.includes(ARCHITECTURE_END_MARKER)
  ) {
    return {
      content: existingContent,
      updated: false,
      note: 'AGENTS.md exists but is missing the <!-- kb:architecture:start --> markers; leaving file untouched.',
    }
  }

  const startIdx = existingContent.indexOf(ARCHITECTURE_START_MARKER)
  const endIdx = existingContent.indexOf(ARCHITECTURE_END_MARKER) + ARCHITECTURE_END_MARKER.length

  const archSection = generateArchitectureSection(arch)
  const replacement = `${ARCHITECTURE_START_MARKER}\n${archSection}\n${ARCHITECTURE_END_MARKER}`

  const newContent =
    existingContent.slice(0, startIdx) + replacement + existingContent.slice(endIdx)

  return {
    content: newContent,
    updated: true,
  }
}
