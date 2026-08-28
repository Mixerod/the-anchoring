#!/usr/bin/env node
/* global process, console */
/**
 * Secret scanner for Tier 1 structured token formats.
 *
 * Enforces INV-SECRETS-NO-LITERALS: no structured credential literal in any tracked file.
 * Tier 2 patterns (bare words) are deliberately excluded to prevent false positives.
 *
 * The `global` comment above declares this file's environment truthfully — it is a Node
 * program, and `process`/`console` are real here. It is not a rule suppression: without it
 * a flat-config ESLint that does not know this path reports `no-undef` false positives,
 * both here and in whichever repository seeds this pack.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const TIER1_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{36}/,
  /github_pat_[A-Za-z0-9_]{22,}/,
  /sk-ant-api03-[A-Za-z0-9_-]{80,}/,
  /sk-proj-[A-Za-z0-9_-]{48,}/,
  /AIzaSy[A-Za-z0-9_-]{33}/,
  /hf_[A-Za-z0-9]{34,}/,
  /AKIA[0-9A-Z]{16}/,
  /xox[baprs]-[0-9A-Za-z-]{10,48}/,
  /sk_live_[0-9a-zA-Z]{24,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]

const EXCLUDED_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage', '.anchor/session'])
const EXCLUDED_FILES = new Set([
  '20-secrets.md',
  'INV-SECRETS-NO-LITERALS.md',
  'anchoring-scan-secrets.mjs',
])

function scanFile(filePath) {
  const content = readFileSync(filePath, 'utf8')
  for (const pattern of TIER1_PATTERNS) {
    const match = content.match(pattern)
    if (match) {
      return { pattern: pattern.source, match: match[0] }
    }
  }
  return null
}

function collectFiles(dir) {
  const results = []
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return results
  }

  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry) || EXCLUDED_FILES.has(entry)) continue
    const full = join(dir, entry)
    try {
      const stat = statSync(full)
      if (stat.isDirectory()) {
        results.push(...collectFiles(full))
      } else if (stat.isFile()) {
        results.push(full)
      }
    } catch {
      // Ignore
    }
  }
  return results
}

export function scanRepository(root = process.cwd()) {
  const files = collectFiles(root)
  const violations = []

  for (const file of files) {
    const found = scanFile(file)
    if (found) {
      violations.push({ file, pattern: found.pattern })
    }
  }

  return violations
}

const root = process.argv[2] ? resolve(process.argv[2]) : process.cwd()
const violations = scanRepository(root)

if (violations.length > 0) {
  console.error(`\nSecret scanner: found ${violations.length} possible secret literal(s):`)
  for (const v of violations) {
    console.error(`  - ${v.file} (matched ${v.pattern})`)
  }
  process.exit(1)
} else {
  console.log('Secret scanner: clean (no Tier 1 secret literals found)')
  process.exit(0)
}
