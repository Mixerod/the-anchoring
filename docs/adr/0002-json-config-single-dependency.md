---
id: ADR-0002
title: JSON configuration format with zero extra runtime dependencies
status: accepted
governs:
  - file:src/config.ts
constrains: []
verified_by: []
supersedes: []
---

# ADR-0002: JSON configuration format with zero extra runtime dependencies

## Context

Configuration files are commonly formatted in YAML, TOML, JSON, or JavaScript/TypeScript. We evaluated formats for `anchoring.config.json`.

The intent graph package commits to maintaining minimal dependencies. The only runtime dependency needed by the core graph is `js-yaml` (used for parsing Markdown frontmatter). Adding a dedicated parser for TOML or another format would introduce additional runtime dependencies. Using JS/TS configs allows unvalidated executable code, breaks static analysis/pure parsing, and complicates multi-tool or multi-agent introspection.

## Decision

1. Use JSON (`anchoring.config.json`) as the configuration file format.
2. Parse JSON using Node's built-in `JSON.parse`, keeping `js-yaml` as the sole runtime dependency of the package.
3. Validate configuration strictly in `parseConfig`, rejecting unknown top-level or kind-level keys and invalid values loudly.

## Consequences

- The package retains exactly one runtime dependency (`js-yaml`).
- `anchoring.config.json` is machine-readable and machine-editable (e.g. by `kb init` or automated tooling) without requiring language-specific runtimes.
- Configuration errors are detected cleanly and reported with actionable diagnostics.
