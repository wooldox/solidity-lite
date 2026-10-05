# Contributing

## Build and test

```bash
npm install
npm run build      # or: npm run watch
npm test           # core tests, against test/fixtures/project
npm run e2e        # runs the providers inside a throwaway Cursor profile
npm run package    # type-checks, builds and packs solidity-lite-<version>.vsix
```

Press F5 to open an Extension Development Host with the extension loaded. `test/sample.sol` covers most of the grammar.

`npm run e2e` starts Cursor from `/Applications/Cursor.app`. To use VS Code instead:

```bash
EDITOR_APP="/Applications/Visual Studio Code.app/Contents/MacOS/Electron" npm run e2e
```

## Layout

- `src/core/` knows nothing about the editor: parsing, scopes, hover text, rename edits. Its tests run in plain Node.
- `src/navigation.ts`, `src/editing.ts`, `src/syntaxErrors.ts` and `src/format.ts` connect it to VS Code through `src/session.ts`.
- `builtins/globals.sol` declares Solidity's built-ins for hover and Go to Definition. It is never compiled.
- `syntaxes/` holds the TextMate grammar used for highlighting.
- `scripts/build.mjs` bundles with esbuild and patches the parser so syntax errors in half-typed code keep their positions.

## Releasing

1. Bump `version` in `package.json` and add an entry to `CHANGELOG.md`.
2. `npm run package`.
3. `npx vsce publish --packagePath solidity-lite-<version>.vsix`, then `npx ovsx publish solidity-lite-<version>.vsix -p <token>`. Publish to the VS Code Marketplace first.
