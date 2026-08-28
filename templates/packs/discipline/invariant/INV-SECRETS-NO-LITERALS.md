---
id: INV-SECRETS-NO-LITERALS
title: No structured credential literals in tracked files
status: active
enforced_by:
  - file:scripts/anchoring-scan-secrets.mjs
holds_for: []
---

# INV-SECRETS-NO-LITERALS: No structured credential literals in tracked files

## Rule

Never write a real credential into a file that a repository, backup, or sync could reach. Configuration files, test fixtures, and scripts must reference credentials via environment variables or secret managers, never as plaintext literals.

Enforcement is strictly based on Tier 1 structured token formats (such as GitHub PATs, AWS access keys, OpenAI/Anthropic API keys, private key blocks). Tier 2 patterns (bare words like `secret` or `password`) are intentionally omitted from machine enforcement due to a 100% false-positive rate on real codebases; scanners that report noise are ignored or disabled.

## Enforcement

Enforced by `scripts/anchoring-scan-secrets.mjs` against tracked files.
