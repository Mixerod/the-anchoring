/**
 * The build that ships must not be older than the source it claims to be.
 *
 * `package.json` points `kb` and `anchoring` at `dist/cli.js`, so that is the program anyone
 * actually runs - the Stop hook included. `npm run verify` never builds, so `dist/` could
 * drift arbitrarily far behind `src/` while typecheck, lint, depcruise and 550 tests all
 * reported success.
 *
 * It did. A Stop hook running `npx kb done --check` failed against a day-old build with
 *
 *     config error: unknown top-level key `tags`
 *
 * for keys the source had understood for hours. Every gate was green; none of them touched
 * the artifact. That is INC-0004's shape a third time: a check answering a question it can
 * answer without looking at the thing that is broken.
 *
 * This compares timestamps rather than rebuilding, because a verification step that writes
 * files is a surprise nobody wants, and the useful signal here is one sentence long.
 */
import { describe, expect, test } from 'vitest'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function newestMtime(dir: string, extension: string): { path: string; mtimeMs: number } | undefined {
  let newest: { path: string; mtimeMs: number } | undefined

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const deeper = newestMtime(full, extension)
      if (deeper && (!newest || deeper.mtimeMs > newest.mtimeMs)) newest = deeper
      continue
    }
    if (!entry.name.endsWith(extension)) continue
    // A test is not shipped, so its edits must not demand a rebuild.
    if (entry.name.includes('.test.') || entry.name.includes('.spec.')) continue

    const { mtimeMs } = statSync(full)
    if (!newest || mtimeMs > newest.mtimeMs) newest = { path: full, mtimeMs }
  }
  return newest
}

describe('the built artifact tracks the source', () => {
  test('dist/ is not older than src/', () => {
    // No dist/ at all is the normal state of a fresh clone, and not something to fail on:
    // `kb` is run through `npm run kb` until somebody builds. The defect is a build that
    // exists and lies about its age.
    if (!existsSync('dist')) return

    const source = newestMtime('src', '.ts')
    const built = newestMtime('dist', '.js')

    expect(source, 'src/ has no source files').toBeDefined()
    expect(built, 'dist/ exists but contains no compiled output; run `npm run build`').toBeDefined()
    if (!source || !built) return

    expect(
      built.mtimeMs,
      `${source.path} is newer than the build in ${built.path}. ` +
        'The `kb` binary points at dist/, so it is running older code than this test suite. ' +
        'Run `npm run build`.',
    ).toBeGreaterThanOrEqual(source.mtimeMs)
  })
})
