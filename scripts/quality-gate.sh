#!/usr/bin/env bash
set -euo pipefail

echo "[quality-gate] 1/6 lint"
npm run lint

echo "[quality-gate] 2/6 typecheck"
npx tsc --noEmit

echo "[quality-gate] 3/6 frontend unit tests"
npm test

echo "[quality-gate] 4/6 frontend integration smoke (vitest subset)"
npx vitest run src/test/store.test.ts src/test/core/plugin-manager.test.ts

echo "[quality-gate] 5/6 rust tests"
if command -v cargo >/dev/null 2>&1; then
  CARGO_BIN=cargo
elif command -v cargo.exe >/dev/null 2>&1; then
  CARGO_BIN=cargo.exe
else
  echo "[quality-gate] cargo not found on PATH" >&2
  exit 1
fi
(cd src-tauri && "$CARGO_BIN" test)

echo "[quality-gate] 6/6 frontend build smoke"
npm run build

echo "[quality-gate] ✅ all checks passed"
