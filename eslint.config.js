// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import anchoringGuards from './anchoring.guards.mjs'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/*.cjs', 'scripts/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...anchoringGuards,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector:
            ':matches(Program, Program > ExportNamedDeclaration) > VariableDeclaration[kind!="const"] > VariableDeclarator[id.name="config"]',
          message:
            'Module-scope mutable `config` is forbidden (INV-CONFIG-THREADED). Pass config as a parameter.',
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts'],
    ignores: [
      'src/**/*.test.ts',
      'src/git.ts',
      'src/loader.ts',
      'src/resolver.ts',
      'src/session.ts',
      'src/init.ts',
      'src/root.ts',
      // The I/O half of `kb upstream`. Declared here for the same reason the five above
      // are: it exists so `src/upstream.ts` can stay pure, and purity there is the
      // redaction guarantee. See the module doc comment.
      'src/cli-upstream.ts',
      'src/pack-source.ts',
      'src/cli-pack.ts',
      'src/cli-promote.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'node:fs',
              message:
                'Core modules must not import fs directly; pass I/O dependencies (INV-INJECTED-IO).',
            },
            {
              name: 'fs',
              message:
                'Core modules must not import fs directly; pass I/O dependencies (INV-INJECTED-IO).',
            },
            {
              name: 'node:fs/promises',
              message:
                'Core modules must not import fs/promises directly; pass I/O dependencies (INV-INJECTED-IO).',
            },
            {
              name: 'fs/promises',
              message:
                'Core modules must not import fs/promises directly; pass I/O dependencies (INV-INJECTED-IO).',
            },
            {
              name: 'node:child_process',
              message:
                'Core modules must not import child_process directly; pass I/O dependencies (INV-INJECTED-IO).',
            },
            {
              name: 'child_process',
              message:
                'Core modules must not import child_process directly; pass I/O dependencies (INV-INJECTED-IO).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/cli.ts'],
    rules: { 'no-console': 'off' },
  },
)
