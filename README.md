# Solidity Lite

Lightweight Solidity support for VS Code and Cursor. No language server, no background process: files are parsed on demand, only when you hover, jump, look for references or open the Outline.

- **Syntax highlighting**: keywords, types, NatSpec tags, constants, variables and properties, plus ```` ```solidity ```` blocks in Markdown.
- **Hover**: the declaration's signature (a struct's fields, an enum's members) and its NatSpec. Parameters show their `@param` line; overrides without NatSpec, and `@inheritdoc`, show the base's.
- **Go to Definition** (Cmd/Ctrl+click, F12): locals, parameters, contract members including inherited ones, `super.` and `this.`, struct fields through variables, mappings and arrays, functions attached with `using … for` (including `global`), enum members, events, errors, and imported symbols. Import paths open the file, following `foundry.toml`/`remappings.txt` remappings and `lib/` the way forge does, then `node_modules`.
- **Built-ins** hover with docs and jump to `builtins/globals.sol`, a declaration file in the spirit of TypeScript's `lib.d.ts`: globals (`keccak256`, `abi.encode`, `msg.sender`, `block.timestamp`, …), members (`addr.balance`, `arr.push`, `type(T).max`, `f.selector`, `Err.selector`, `Price.wrap`, `bytes32.length`), units (`ether`, `days`), `this`/`super`, and inside `assembly { }` the Yul built-ins (`mload`, `sstore`, `call`, …), `let` variables, Yul functions and `.slot`/`.offset`.
- **Find All References** (Shift+F12, or Cmd/Ctrl+click on a declaration's own name) across the workspace's `.sol` files, skipping `lib/`, `node_modules/` and build output. Only files containing the name as text are parsed.
- **Highlights** every use of the symbol under the cursor in the current file.
- **Outline**, breadcrumbs and Go to Symbol (Cmd/Ctrl+Shift+O), with parameter types to tell overloads apart.
- **Go to Symbol in Workspace** (Cmd/Ctrl+T) across the project's `.sol` files. The first search parses them all (about 2 s for 50 files); later ones are instant.
- **Selectors**: hovering an external/public function, public variable or error shows its 4-byte selector and canonical signature; an event shows its topic0.
- **Autocomplete**: members after `.` (struct fields, contract functions, `using … for` functions, built-in members) and every name in scope, with signatures and docs.
- **Parameter hints** while typing a call: every overload, the current parameter highlighted, its `@param` text.
- **Rename** (F2) across the project, including overrides in base and derived contracts and `@param` lines. Refuses built-ins and names declared in dependencies.
- **Call hierarchy** (who calls this function, what it calls) and **type hierarchy** (bases and derived contracts).
- **`///` template**: typing `///` above a declaration offers a NatSpec skeleton with its `@param` and `@return` lines.
- **Syntax errors** underlined as you type, from the parser alone (no compiler: typos and brackets, not types). Off with `solidityLite.syntaxErrors`.
- **Format Document**: runs `forge fmt` on the buffer from the nearest folder with a `foundry.toml`, so your `[fmt]` settings apply. Errors show briefly in the status bar, with details in the *Solidity Lite* output channel.

Names are resolved from scopes and declarations, without a compiler. Overloads are told apart by argument count and simple argument types; when that is not enough, every candidate is offered. Expressions it cannot type (say, the result of a ternary) do not resolve.

## Settings

| Setting | Default | |
|---|---|---|
| `solidityLite.forgePath` | `forge` | Falls back to `~/.foundry/bin/forge` when `forge` is not on the PATH. |
| `solidityLite.syntaxErrors` | `true` | Underline syntax errors while typing. |

To format on save:

```json
"[solidity]": {
  "editor.defaultFormatter": "wooldox.solidity-lite",
  "editor.formatOnSave": true
}
```

## Develop

```bash
npm install
npm run build      # or: npm run watch
npm test           # core tests, against test/fixtures/project
npm run e2e        # runs the providers inside a throwaway Cursor profile
npm run package    # type-checks, builds and packs solidity-lite-<version>.vsix
```

Press F5 to open an Extension Development Host. `test/sample.sol` covers most of the grammar.

`src/core/` knows nothing about the editor (parsing, scopes, hover text, rename edits); `src/navigation.ts`, `src/editing.ts`, `src/syntaxErrors.ts` and `src/format.ts` connect it to VS Code through `src/session.ts`. `scripts/build.mjs` bundles with esbuild and patches the parser so syntax errors in half-typed code keep their positions.

## Credits

The grammar and language configuration come from Nomic Foundation's [hardhat-vscode](https://github.com/NomicFoundation/hardhat-vscode) (MIT), with small additions for constants, identifiers and newer keywords. See `LICENSE`.
