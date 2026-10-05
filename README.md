<p align="center">
  <img src="images/icon.png" alt="Solidity Lite" width="128" height="128">
</p>

<h1 align="center">Solidity Lite</h1>

<p align="center">
  <b>Solidity in VS Code and Cursor, without the weight.</b><br>
  Hover, go to definition, references, rename and autocomplete, with no language server running in the background.
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=wooldox.solidity-lite"><img alt="VS Marketplace" src="https://img.shields.io/badge/VS%20Marketplace-install-4f46e5"></a>
  <a href="https://open-vsx.org/extension/wooldox/solidity-lite"><img alt="Open VSX" src="https://img.shields.io/open-vsx/v/wooldox/solidity-lite?label=Open%20VSX&color=14b8a6"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-64748b"></a>
</p>

---

## Why

Most Solidity extensions start a language server that indexes your whole workspace, dependencies included, and recompiles as you type. On a big Foundry project that means a busy CPU and a warm laptop.

Solidity Lite does nothing until you ask. Highlighting is a grammar the editor applies itself. Everything else parses only the file you are in, and what it imports, when you hover, click or type. It starts in about 20 ms and has no process of its own.

## Features

### Reading code

- **Hover** shows the declaration and its NatSpec: a function's signature, a struct's fields, a parameter's `@param` line. Overrides without docs borrow their base's, and `@inheritdoc` is followed.
- **Selectors on hover**: external functions, public variables and errors show their 4-byte selector (`transfer(address,uint256)` → `0xa9059cbb`); events show their topic0.
- **Go to Definition** (Cmd/Ctrl+click) through locals, inherited members, `super.` and `this.`, struct fields behind mappings and arrays, `using … for` functions (including `global`), and imports. Import paths open the file, following `foundry.toml` and `remappings.txt` the way forge does.
- **Find All References** and **highlights** of every use of the symbol under the cursor.
- **Outline**, breadcrumbs, **Go to Symbol in Workspace** (Cmd/Ctrl+T), **call hierarchy** and **type hierarchy**.

### Writing code

- **Autocomplete** for members after `.` and every name in scope, with signatures and docs.
- **Parameter hints** while typing a call, across overloads.
- **Rename** (F2) across the project, overrides in base and derived contracts and `@param` lines included.
- **`///` template**: type `///` above a declaration to get its `@param` and `@return` lines.
- **Syntax errors** underlined as you type, from the parser alone.
- **Format Document** with `forge fmt`, using your project's `[fmt]` settings.

### Built-ins

`keccak256`, `abi.encode`, `msg.sender`, `block.timestamp`, `addr.balance`, `type(T).max`, `Err.selector`, `Price.wrap`, units like `ether` and `days`, and inside `assembly { }` every Yul built-in, all with docs on hover. Cmd/Ctrl+click opens [`builtins/globals.sol`](builtins/globals.sol), a declaration file in the spirit of TypeScript's `lib.d.ts`.

## Requirements

None for most features. Format Document needs [Foundry](https://getfoundry.sh) (`forge`).

## Settings

| Setting | Default | Description |
|---|---|---|
| `solidityLite.forgePath` | `forge` | The `forge` binary for Format Document. Falls back to `~/.foundry/bin/forge` when `forge` is not on the PATH. |
| `solidityLite.syntaxErrors` | `true` | Underline syntax errors while typing. |

To format on save, add this to your settings:

```json
"[solidity]": {
  "editor.defaultFormatter": "wooldox.solidity-lite",
  "editor.formatOnSave": true
}
```

## How it works, and its limits

Names are resolved from scopes and declarations, the way you would read the code, not by a compiler. That keeps it fast and light, with two consequences:

- Overloads are told apart by argument count and simple argument types. When that is not enough, every candidate is offered.
- Expressions it cannot type, such as the result of a ternary, do not resolve.

Syntax errors come from the parser, so they catch typos and unbalanced brackets, not type errors. Run `forge build` for those.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) to build and test it locally.

## Credits

The grammar and language configuration come from Nomic Foundation's [hardhat-vscode](https://github.com/NomicFoundation/hardhat-vscode) (MIT), with additions for constants, identifiers and newer keywords.

## License

[MIT](LICENSE)
