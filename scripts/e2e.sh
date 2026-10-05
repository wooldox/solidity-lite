#!/usr/bin/env bash
# Runs test/e2e in a throwaway profile of Cursor and prints the results.
# EDITOR_APP=/Applications/Visual\ Studio\ Code.app/Contents/MacOS/Electron runs it in VS Code instead.
set -euo pipefail
cd "$(dirname "$0")/.."
app="${EDITOR_APP:-/Applications/Cursor.app/Contents/MacOS/Cursor}"
tmp="$(mktemp -d)"
npm run build >/dev/null
npx esbuild test/e2e/index.ts --bundle --platform=node --format=cjs --external:vscode --outfile=out-test/e2e/index.js --log-level=warning
E2E_OUT="$tmp/results.json" "$app" --new-window --skip-welcome --skip-release-notes \
  --user-data-dir "$tmp/user" --extensions-dir "$tmp/extensions" --disable-extensions \
  --extensionDevelopmentPath="$PWD" --extensionTestsPath="$PWD/out-test/e2e/index.js" \
  "$PWD/test/fixtures/project" >/dev/null 2>&1 || true
cat "$tmp/results.json"
rm -rf "$tmp"
