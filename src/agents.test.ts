import { describe, expect, test } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  generateArchitectureSection,
  renderAgentsMd,
  updateAgentsMd,
  ARCHITECTURE_START_MARKER,
  ARCHITECTURE_END_MARKER,
} from './agents.js'
import { planInit } from './init.js'
import type { Architecture } from './config.js'
import { run } from './cli.js'

function makeTemp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

const SAMPLE_ARCH: Architecture = {
  layers: [
    { name: 'ui', paths: ['src/ui/'], pure: false },
    { name: 'app', paths: ['src/app/'], pure: false },
    { name: 'domain', paths: ['src/domain/'], pure: true },
    { name: 'infra', paths: ['src/infra/'], pure: false },
  ],
  moduleRoots: ['src/modules/'],
  entryPoints: ['index.ts'],
  maxFileLines: 400,
  maxFunctionLines: 50,
  impureImports: ['node:fs'],
}

describe('agents architecture section generation', () => {
  test('layer diagram matches configured order', () => {
    const section = generateArchitectureSection(SAMPLE_ARCH)
    expect(section).toContain('ui\n  ↓\napp\n  ↓\ndomain (pure)\n  ↓\ninfra')
    expect(section).toContain('INV-DEP-DIRECTION')
    expect(section).toContain('INV-NO-CYCLES')
    expect(section).toContain('INV-MODULE-ENTRY')
    expect(section).toContain('INV-PURE-CORE')
    expect(section).toContain('INV-FILE-SIZE')
  })

  test('empty architecture produces prose sections but no layer diagram', () => {
    const section = generateArchitectureSection({
      layers: [],
      moduleRoots: [],
      entryPoints: ['index.ts'],
      maxFileLines: 400,
      maxFunctionLines: 50,
      impureImports: [],
    })

    expect(section).not.toContain('### Layer Order')
    expect(section).not.toContain('↓')
    expect(section).toContain('UI and controllers only move data')
    expect(section).toContain('One concept, one name, everywhere')
    expect(section).toContain('Split on two reasons to change, not on line count')
  })

  test('generated section contains no absolute paths and no host-specific names', () => {
    const section = generateArchitectureSection(SAMPLE_ARCH)
    expect(section).not.toMatch(/[a-zA-Z]:[\\/]/)
    expect(section).not.toContain('/home/')
    expect(section).not.toContain('/Users/')
    expect(section).not.toContain('dicebound')
  })
})

describe('renderAgentsMd and updateAgentsMd', () => {
  const template = `# AGENTS.md\n\nTop\n\n${ARCHITECTURE_START_MARKER}\nold arch\n${ARCHITECTURE_END_MARKER}\n\nBottom\n`

  test('marker block is replaced in place with surrounding text preserved verbatim', () => {
    const res = updateAgentsMd(template, SAMPLE_ARCH)
    expect(res.updated).toBe(true)
    expect(res.content.startsWith('# AGENTS.md\n\nTop\n\n<!-- kb:architecture:start -->')).toBe(true)
    expect(res.content.endsWith('<!-- kb:architecture:end -->\n\nBottom\n')).toBe(true)
    expect(res.content).toContain('domain (pure)')
    expect(res.content).not.toContain('old arch')
  })

  test('absent markers produce a note and no write', () => {
    const raw = '# Custom AGENTS.md with no markers\n'
    const res = updateAgentsMd(raw, SAMPLE_ARCH)
    expect(res.updated).toBe(false)
    expect(res.content).toBe(raw)
    expect(res.note).toContain('missing the <!-- kb:architecture:start --> markers')
  })

  test('renderAgentsMd replaces marker block in template', () => {
    const rendered = renderAgentsMd(template, SAMPLE_ARCH)
    expect(rendered).toContain('domain (pure)')
    expect(rendered).toContain('Bottom')
  })
})

describe('AGENTS.md file lifecycle in init and guards', () => {
  test('file is written by init when absent and not when present', () => {
    const files = new Map<string, string>()
    const probe = (p: string) => files.has(p)

    // First run: absent -> written
    const plan1 = planInit('/repo', {}, probe)
    const agentsFile = plan1.files.find((f) => f.path === 'AGENTS.md')
    expect(agentsFile).toBeDefined()
    expect(agentsFile?.body).toContain('<!-- kb:architecture:start -->')

    // Second run: present -> not written, note added
    files.set('AGENTS.md', 'Custom existing AGENTS.md')
    files.set('anchoring.config.json', '{}')
    const plan2 = planInit('/repo', { force: true }, probe)
    expect(plan2.files.some((f) => f.path === 'AGENTS.md')).toBe(false)
    expect(plan2.notes.some((n) => n.includes('AGENTS.md already exists'))).toBe(true)
  })

  test('kb guards updates AGENTS.md in place when markers are present', () => {
    const root = makeTemp('kb-agents-cli-')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'test-pkg' }))
    writeFileSync(
      join(root, 'anchoring.config.json'),
      JSON.stringify({ architecture: SAMPLE_ARCH }, null, 2),
    )
    writeFileSync(
      join(root, 'AGENTS.md'),
      `# AGENTS.md\n\nCustom Header\n\n${ARCHITECTURE_START_MARKER}\nold\n${ARCHITECTURE_END_MARKER}\n\nCustom Footer\n`,
    )

    const out: string[] = []
    const code = run(['guards'], (t) => out.push(t), () => {}, root)
    expect(code).toBe(0)

    const updated = readFileSync(join(root, 'AGENTS.md'), 'utf8')
    expect(updated).toContain('Custom Header')
    expect(updated).toContain('Custom Footer')
    expect(updated).toContain('domain (pure)')
    expect(updated).not.toContain('\nold\n')
  })

  test('kb guards --check detects stale and ok AGENTS.md', () => {
    const root = makeTemp('kb-agents-check-')
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'test-pkg' }))
    writeFileSync(
      join(root, 'anchoring.config.json'),
      JSON.stringify({ architecture: SAMPLE_ARCH }, null, 2),
    )
    writeFileSync(
      join(root, 'AGENTS.md'),
      `# AGENTS.md\n\n${ARCHITECTURE_START_MARKER}\nstale arch block\n${ARCHITECTURE_END_MARKER}\n`,
    )

    // Generate guards files so .mjs / .cjs are ok
    run(['guards'], () => {}, () => {}, root)

    // Revert AGENTS.md to stale
    writeFileSync(
      join(root, 'AGENTS.md'),
      `# AGENTS.md\n\n${ARCHITECTURE_START_MARKER}\nstale arch block\n${ARCHITECTURE_END_MARKER}\n`,
    )

    const out: string[] = []
    const checkCode = run(['guards', '--check'], (t) => out.push(t), () => {}, root)
    expect(checkCode).toBe(1)
    expect(out.join('\n')).toContain('AGENTS.md: stale')

    // Update with guards
    run(['guards'], () => {}, () => {}, root)
    const out2: string[] = []
    const checkCode2 = run(['guards', '--check'], (t) => out2.push(t), () => {}, root)
    expect(checkCode2).toBe(0)
    expect(out2.join('\n')).toContain('AGENTS.md: ok')
  })
})
