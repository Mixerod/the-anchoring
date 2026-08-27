#!/bin/sh
# Fast gate. Anything slower than ~10s belongs in CI, not here.
set -e

hooks_dir=$(dirname "$0")

git diff --cached --name-status \
  | sh "$hooks_dir/guard.sh" "staged for commit"

echo "[pre-commit] typecheck + lint"
pnpm typecheck
pnpm lint

# Not --strict here: a missing codegraph index should warn locally, not block a commit.
# CI runs the strict version, and CI is the gate that cannot be bypassed.
echo "[pre-commit] knowledge base"
pnpm check:kb
