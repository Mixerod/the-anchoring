// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import anchoringGuards from './anchoring.guards.mjs'

// The architecture rules are GENERATED, from anchoring.config.json.
//
// Nothing below may re-declare a rule that `anchoringGuards` sets. ESLint flat config does
// not merge rules: two config objects naming one rule means the later one replaces the
// earlier, entirely and silently. Hand-written blocks here previously did exactly that to
// `no-restricted-imports` and `no-restricted-syntax`, which switched off the pure-layer
// import ban for node:http, node:https and node:crypto, and the ban on `new Date()`, with
// no error and no output. See .anchor/incident/INC-0004.md.
//
// The exemption list and the project's own selectors now live in anchoring.config.json
// (`ioExemptions`, `restrictedSyntax`) so that they compose instead of colliding.
export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/*.cjs', 'scripts/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...anchoringGuards,
  {
    files: ['src/**/*.ts'],
    rules: { 'no-console': 'error' },
  },
  {
    files: ['src/cli.ts'],
    rules: { 'no-console': 'off' },
  },
)
