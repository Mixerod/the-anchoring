// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
      'src/anchors.ts',
      'src/frontmatter.ts',
      'src/store.ts',
      'src/session.ts',
      'src/config.ts',
      'src/init.ts',
      'src/root.ts',
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
